import { tmdbGet, type TmdbItem } from '../metadata/tmdb';
import inventory from './official-works.json';
import { getOrderCache, saveOrderCache } from '../db/queries';
import type { FileOption } from '../showbox';
import { cachedListing } from './videoListing';

export interface OfficialWork {
	videoId: string; title: string; type: string; channel: string; uploadTitle: string;
	collectionOnly?: boolean; desktopVerified?: boolean;
	year?: number | null; season?: number | null; episode?: number | null; episodeTitle?: string | null; tmdbEpisodeId?: number; playlistId?: string | null;
}
export const works: OfficialWork[] = inventory;
const byId = new Map(works.map(w => [w.videoId, w]));
const clean = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const releaseKey = (title: string, year: string | number, type: string) => JSON.stringify([clean(title), Number(year), type]);
const releases = new Map<string, OfficialWork[]>();
for (const w of works) {
	if (!w.year || w.collectionOnly) continue;
	const type = w.type === 'episode' && (w.episodeTitle || (Number(w.season) > 0 && Number(w.episode) > 0)) ? 'tv' : ['short','movie'].includes(w.type) ? 'movie' : '';
	if (!type) continue;
	const key = releaseKey(w.title, w.year, type);
	if (!releases.has(key)) releases.set(key, []);
	releases.get(key)!.push(w);
}
const candidates = (title: string, year: string | number, type: string) => releases.get(releaseKey(title, year, type)) ?? [];
type Matched = OfficialWork & { tmdb: string; poster: string; season: number; episode: number };
const jobs = new Map<string, Promise<Matched[]>>();
const episodeName = (s: string) => clean(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
type Episode = { id?: number; season: number; episode: number; name: string; seasonName?: string };
export function placeEpisode(w: OfficialWork, episodes: Episode[]) {
	if (w.tmdbEpisodeId) return episodes.find(e => e.id === w.tmdbEpisodeId);
	if (w.episodeTitle) {
		const name = episodeName(w.episodeTitle);
		const same = episodes.filter(e => name && episodeName(e.name) === name);
		if (same.length !== 1) return;
		const parts = w.uploadTitle.split(/\s*\|\s*|\s+[-–—]\s+/).map(p => episodeName(p.replace(/\s*\(Full Episode\)\s*$/i, '')));
		const labels = new Set([episodeName(w.title), episodeName(w.channel), episodeName(same[0].seasonName || '')]);
		const otherNames = new Set(parts.filter(p => p && p !== name && !labels.has(p)));
		// A TMDB season label can also be an episode title (e.g. Super Megaforce).
		if (parts.includes(name) && episodes.some(e => otherNames.has(episodeName(e.name)))) return;
		return same[0];
	}
	// Only an explicit publisher coordinate, never a playlist position or inferred absolute number.
	const match = /\bS(?:eason)?\s*0*(\d+)\s*[-,:| ]*E(?:p(?:isode)?)?\.?\s*0*(\d+)\b/i.exec(w.uploadTitle);
	const pilot = w.videoId === '1jtdfuDcqxI' && w.season === 1 && w.episode === 1 && /第1話/.test(w.uploadTitle);
	if (!pilot && (!match || +match[1] !== w.season || +match[2] !== w.episode)) return;
	const placed = episodes.find(e => e.season === w.season && e.episode === w.episode);
	if (!placed || pilot) return placed;
	// Some audit rows have no parsed episodeTitle but still name an episode in the upload.
	const rest = ' ' + episodeName(w.uploadTitle.replace(match![0], '')) + ' ';
	const label = rest.replace(` ${episodeName(w.title)} `, ' ').replace(` ${episodeName(w.channel)} `, ' ').replace(/\b(?:full episodes?|official|hd|4k)\b/g, '').trim();
	if (!label) return placed;
	const name = episodeName(placed.name);
	return name && (` ${label} `).includes(` ${name} `) ? placed : undefined;
}

/** The inventory is evidence, not a library. A unique TMDB release must own each returned source. */
export async function publisherMatches(title: string, year: string | number, type: string, expected?: string): Promise<Matched[]> {
	const rows = candidates(title, year, type);
	if (!rows.length) return [];
	const key = 'publisher-match-v4|' + releaseKey(title, year, type) + '|' + rows.length;
	let job = jobs.get(key);
	if (!job) {
		job = (async () => {
			type Placement = [string, number, number];
			type Result = { tmdb: string; poster: string; places: Placement[] };
			const hydrate = (r: Result): Matched[] => r.places.flatMap(([id, season, episode]) => {
				const w = byId.get(id); return w ? [{ ...w, tmdb: r.tmdb, poster: r.poster, season, episode }] : [];
			});
			const cache = getOrderCache(key);
			if (cache && Date.now() - cache.at < 86400000) return hydrate(cache.value as Result);
			const y = String(year);
			const search = await tmdbGet<{ results: TmdbItem[]; total_pages?: number }>(`/search/${type}`, { query: title, [type === 'movie' ? 'year' : 'first_air_date_year']: y });
			if (!search?.results || (search.total_pages ?? 1) > 1) return [];
			const hits = search.results.filter(h => (h.release_date || h.first_air_date)?.slice(0,4) === y && [h.title,h.name,h.original_title,h.original_name].some(n => n && clean(n) === clean(title)));
			if (hits.length !== 1) return [];
			const hit = hits[0];
			const r: Result = { tmdb: `${type}:${hit.id}`, poster: hit.poster_path ? `https://image.tmdb.org/t/p/w342${hit.poster_path}` : '', places: [] };
			let complete = true;
			if (type === 'movie') r.places = rows.map(w => [w.videoId, 0, 0]);
			else {
				const show = await tmdbGet<{ seasons: { season_number: number; name?: string }[] }>(`/tv/${hit.id}`);
				if (!show?.seasons) return [];
				const episodes: Episode[] = [];
				const seasons = show.seasons.filter(s => s.season_number > 0 || rows.some(w => w.season === 0 && w.tmdbEpisodeId));
				for (let i = 0; i < seasons.length; i += 4) {
					const batch = await Promise.all(seasons.slice(i,i+4).map(async s => {
						const data = await tmdbGet<{ episodes: { id?: number; episode_number: number; name: string }[] }>(`/tv/${hit.id}/season/${s.season_number}`);
						return data?.episodes?.map(e => ({ id:e.id, season:s.season_number, episode:e.episode_number, name:e.name || '', seasonName:s.name }));
					}));
					for (const s of batch) { if (s) episodes.push(...s); else complete = false; }
				}
				for (const w of rows) {
					if (!complete && !w.tmdbEpisodeId) continue;
					const ep = placeEpisode(w, episodes); if (ep) r.places.push([w.videoId, ep.season, ep.episode]); }
			}
			if (complete) saveOrderCache(key, r, Date.now());
			return hydrate(r);
		})().finally(() => jobs.delete(key));
		jobs.set(key, job);
	}
	const matches = await job;
	return expected ? matches.filter(w => w.tmdb === expected) : matches;
}
export async function scopedPublisher(id: string, params: URLSearchParams) {
	const w = byId.get(id);
	const scope = params.get('scope') || '';
	if (!w?.year || !/^(movie|tv):[1-9]\d*$/.test(scope)) return;
	return (await publisherMatches(w.title, w.year, scope.split(':')[0], scope)).find(m => m.videoId === id && String(m.season) === params.get('s') && String(m.episode) === params.get('e'));
}
// Decoder-checked at audit time, or confirmed by the native player's playing event on this host.
const proofKey = 'official-native-playback-v1';
let confirmed: Set<string> | null = null;
function confirmations() {
	if (!confirmed) {
		const ids = getOrderCache(proofKey)?.value;
		confirmed = new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && byId.has(id)) : []);
	}
	return confirmed;
}
export const nativeConfirmed = (w: OfficialWork) => Boolean(w.desktopVerified) || confirmations().has(w.videoId);
export const nativeRevision = () => confirmations().size;
export function confirmNative(w: OfficialWork) {
	if (!nativeConfirmed(w)) saveOrderCache(proofKey, [...confirmations().add(w.videoId)], Date.now());
}
// Stable across inventory edits; well outside the existing synthetic file-id range.
export function officialFile(w: OfficialWork): FileOption {
	let n = 2166136261;
	for (const c of w.videoId) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
	return { fid: -1_000_000 - (n & 0x3fffffff), quality: '', size: '', name: w.uploadTitle, source: `YouTube · ${w.channel}`, shareKey: `channel:${w.videoId}` };
}
export async function officialMovies(title: string, year: string, tmdbId: number) {
	const rows = await publisherMatches(title, year, 'movie', `movie:${tmdbId}`);
	return rows.filter(w => cachedListing(w.videoId) !== 'unavailable').map(officialFile);
}
