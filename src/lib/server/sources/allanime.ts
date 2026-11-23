/**
 * AllAnime (mkissa.to): anime by its own show IDs, searched by name. Japanese audio with
 * English subtitles and English dubs, up to 1080p.
 *
 * The AllAnime API (api.allanime.day/api, GraphQL) answers show searches and episode lists
 * without authentication. Episode source URLs need a Cloudflare Turnstile token, so the
 * actual video is found by opening the mkissa.to episode page in the desktop app's hidden
 * browser window (electron/main.cjs, `findOnMkissa`) and noting the first HLS playlist it
 * plays. The video servers only answer their player (various embedded domains), so the video
 * comes through Catalog's relay.
 *
 * Only in the desktop app: elsewhere AllAnime never has anything.
 */
import { getOrderCache, saveOrderCache } from '../db/queries';
import { electronMovyFind } from '../electron-fetch';
import { trustVideoHost } from '../relayHosts';
import { noteSourceAnswer } from '../sourceAnswers';
import type { FileOption } from '../showbox';

const API = 'https://api.mkissa.net/api';
const SITE = 'https://mkissa.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

export interface AllanimeShow {
	id: string;
	name: string;
	type: string;
	sub: number;
	dub: number;
	/** YYYY-MM-DD when it started airing. */
	start: string | null;
}

export type AllanimeKind = 'sub' | 'dub';

export function allanimeShareKey(showId: string, episode: number, kind: AllanimeKind): string {
	return `allanime:${showId}:${episode}:${kind}`;
}

export function parseAllanimeShareKey(shareKey: string): { showId: string; episode: number; kind: AllanimeKind } | null {
	const m = /^allanime:([A-Za-z0-9]+):(\d+):(sub|dub)$/.exec(shareKey);
	return m ? { showId: m[1], episode: Number(m[2]), kind: m[3] as AllanimeKind } : null;
}

function saved<T>(key: string, maxAge: number): T | undefined {
	const hit = getOrderCache(key);
	return hit && Date.now() - hit.at < maxAge ? (hit.value as T) : undefined;
}

/* ------------------------------------------------ API */

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
	try {
		const resp = await fetch(API, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: SITE },
			body: JSON.stringify({ query, variables }),
			signal: AbortSignal.timeout(12_000)
		});
		if (!resp.ok) return null;
		const json = (await resp.json()) as { data?: T };
		return json.data ?? null;
	} catch {
		return null;
	}
}

/* ------------------------------------------------ search */

const SEARCH_QUERY = `query($search:SearchInput,$limit:Int,$page:Int,$translationType:VaildTranslationTypeEnumType!,$countryOrigin:VaildCountryOriginEnumType){shows(search:$search,limit:$limit,page:$page,translationType:$translationType,countryOrigin:$countryOrigin){edges{_id name availableEpisodes __typename}}}`;

export async function searchAllanime(query: string): Promise<AllanimeShow[]> {
	const key = `allanime-search|${query.toLowerCase()}`;
	const known = saved<AllanimeShow[]>(key, 24 * HOUR);
	if (known) return known;

	type Edge = { _id: string; name: string; availableEpisodes: { sub: number; dub: number } };
	const data = await graphql<{ shows: { edges: Edge[] } }>(SEARCH_QUERY, {
		search: { allowAdult: false, allowUnknown: false, query: query.replace(/ /g, '+') },
		limit: 40,
		page: 1,
		translationType: 'sub',
		countryOrigin: 'ALL'
	});
	if (!data) return [];
	const shows = data.shows.edges.map((e) => ({
		id: e._id,
		name: e.name,
		type: 'TV',
		sub: e.availableEpisodes.sub,
		dub: e.availableEpisodes.dub,
		start: null as string | null
	}));
	saveOrderCache(key, shows, Date.now());
	return shows;
}

/* ------------------------------------------------ show details */

const SHOW_QUERY = `query($showId:String!){show(_id:$showId){_id name availableEpisodesDetail airedStart type}}`;

export async function allanimeShowDetails(showId: string): Promise<{ sub: number; dub: number; start: string | null; type: string } | null> {
	const key = `allanime-show|${showId}`;
	const known = saved<{ sub: number; dub: number; start: string | null; type: string }>(key, 12 * HOUR);
	if (known) return known;

	type Detail = { sub: string[]; dub: string[] };
	type Start = { year: number; month: number; date: number } | null;
	const data = await graphql<{ show: { availableEpisodesDetail: Detail; airedStart: Start; type: string } }>(SHOW_QUERY, { showId });
	if (!data?.show) return null;
	const { availableEpisodesDetail: eps, airedStart, type } = data.show;
	const sub = eps.sub?.length ?? 0;
	const dub = eps.dub?.length ?? 0;
	let start: string | null = null;
	if (airedStart?.year) {
		const y = String(airedStart.year);
		const m = String(airedStart.month ?? 1).padStart(2, '0');
		const d = String(airedStart.date ?? 1).padStart(2, '0');
		start = `${y}-${m}-${d}`;
	}
	const result = { sub, dub, start, type: type || 'TV' };
	saveOrderCache(key, result, Date.now());
	return result;
}

/* ------------------------------------------------ episode sources (API-direct) */

const EPISODE_QUERY = `query($showId:String!,$translationType:VaildTranslationTypeEnumType!,$episodeString:String!){episode(showId:$showId,translationType:$translationType,episodeString:$episodeString){episodeString sourceUrls}}`;

interface SourceUrl {
	sourceUrl: string;
	sourceName: string;
	type: string;
	className: string;
	streamerId: string;
}

function decryptSourceUrl(enc: string): string {
	if (!enc.startsWith('--')) return enc;
	const hex = enc.slice(2);
	let out = '';
	for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16) >> 3 ^ 56);
	return out;
}

async function resolveClockUrl(clockUrl: string): Promise<string | null> {
	try {
		const resp = await fetch(clockUrl, {
			headers: { 'User-Agent': UA, Referer: `${SITE}/` },
			signal: AbortSignal.timeout(10_000)
		});
		if (!resp.ok) return null;
		const json = await resp.json() as { links?: { link: string; hls?: boolean; mp4?: boolean; resolutionStr?: string }[] };
		if (!json.links?.length) return null;
		const hls = json.links.find((l) => l.hls) ?? json.links.find((l) => /\.m3u8/i.test(l.link)) ?? json.links[0];
		return hls?.link || null;
	} catch {
		return null;
	}
}

async function allanimeApiStream(showId: string, episode: number, kind: AllanimeKind): Promise<string | null> {
	type EpData = { episode: { sourceUrls: SourceUrl[] } | null };
	const data = await graphql<EpData>(EPISODE_QUERY, { showId, translationType: kind, episodeString: String(episode) });
	if (!data?.episode?.sourceUrls?.length) return null;
	for (const src of data.episode.sourceUrls) {
		const decoded = decryptSourceUrl(src.sourceUrl);
		if (/allanime\.day/.test(decoded) && /clock/.test(decoded)) {
			const url = await resolveClockUrl(decoded.startsWith('http') ? decoded : `https://${decoded}`);
			if (url) return url;
		}
	}
	for (const src of data.episode.sourceUrls) {
		const decoded = decryptSourceUrl(src.sourceUrl);
		if (/\.m3u8/i.test(decoded)) return decoded.startsWith('http') ? decoded : `https://${decoded}`;
	}
	for (const src of data.episode.sourceUrls) {
		const decoded = decryptSourceUrl(src.sourceUrl);
		if (decoded.startsWith('http') && /allanime|clock|apivtwo/i.test(decoded)) {
			const url = await resolveClockUrl(decoded);
			if (url) return url;
		}
	}
	return null;
}

/* ------------------------------------------------ stream */

const pageFor = (showId: string, episode: number, kind: AllanimeKind) =>
	`${SITE}/anime/${showId}/p-${episode}-${kind}`;

/** What AllAnime's video servers expect to be asked with. */
export const ALLANIME_HEADERS = { 'User-Agent': UA, Referer: `${SITE}/`, Origin: SITE };

const urlCache = new Map<string, { at: number; url: string | null }>();
const asking = new Map<string, Promise<string | null>>();

async function resolveSources(sources: SourceUrl[]): Promise<string | null> {
	for (const src of sources) {
		const decoded = decryptSourceUrl(src.sourceUrl);
		if (/allanime|clock|apivtwo/i.test(decoded)) {
			const full = decoded.startsWith('http') ? decoded : `https://${decoded}`;
			const url = await resolveClockUrl(full);
			if (url) return url;
		}
	}
	for (const src of sources) {
		const decoded = decryptSourceUrl(src.sourceUrl);
		if (/\.m3u8/i.test(decoded)) return decoded.startsWith('http') ? decoded : `https://${decoded}`;
	}
	return null;
}

export function allanimeStream(shareKey: string, fresh = false): Promise<string | null> {
	const parsed = parseAllanimeShareKey(shareKey);
	if (!parsed) return Promise.resolve(null);
	const kept = urlCache.get(shareKey);
	if (kept && !fresh) {
		const age = Date.now() - kept.at;
		if (kept.url ? age < 30 * MINUTE : age < 6 * 60 * MINUTE) return Promise.resolve(kept.url);
	}
	const under = asking.get(shareKey);
	if (under) return under;
	const result = (async () => {
		const epUrl = pageFor(parsed.showId, parsed.episode, parsed.kind);
		const { url, error, sources } = await electronMovyFind(epUrl, undefined, 'allanime');
		if (url) {
			trustVideoHost(url, 'allanime');
			urlCache.set(shareKey, { at: Date.now(), url });
			return url;
		}
		if (sources?.length) {
			const resolved = await resolveSources(sources as SourceUrl[]);
			if (resolved) {
				trustVideoHost(resolved, 'allanime');
				urlCache.set(shareKey, { at: Date.now(), url: resolved });
				return resolved;
			}
		}
		if (error === 'none' || error === 'no sources after polling') noteSourceAnswer('AllAnime', { type: 'tv', id: 0, season: 0, episode: 0 }, false);
		if (error === 'timeout') urlCache.set(shareKey, { at: Date.now() - 6 * 60 * MINUTE + 10 * MINUTE, url: null });
		return null;
	})().finally(() => asking.delete(shareKey));
	asking.set(shareKey, result);
	return result;
}

/* ------------------------------------------------ copies */

export function allanimeCopies(showId: string, episode: number, has: { sub: boolean; dub: boolean }): FileOption[] {
	const list: FileOption[] = [];
	if (has.sub) {
		list.push({
			fid: -20,
			quality: '1080p',
			name: 'AllAnime · Japanese audio',
			size: '',
			source: 'AllAnime',
			audio: 'Japanese',
			shareKey: allanimeShareKey(showId, episode, 'sub')
		});
	}
	if (has.dub) {
		list.push({
			fid: -21,
			quality: '1080p',
			name: 'AllAnime · English dub',
			size: '',
			source: 'AllAnime',
			audio: 'English',
			shareKey: allanimeShareKey(showId, episode, 'dub')
		});
	}
	return list;
}
