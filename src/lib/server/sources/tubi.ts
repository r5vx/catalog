/**
 * Tubi (tubitv.com): free films and shows with adverts. Some studio content is
 * Widevine-encrypted (DRM); those titles are skipped because BuyDRM's license server
 * rejects Electron's CDM provisioning (the DLL is identical to Chrome's, but Widevine
 * provisions per host app and BuyDRM only trusts Chrome's certificate). Titles with
 * plain HLS work fine.
 *
 * Data comes from the page's server-rendered `window.__data` (video_resources, IMDB id,
 * subtitles). The data has JavaScript `undefined` values, replaced with `null` for JSON.
 *
 * Content discovery: 8 movie sitemaps (~72 000 films with titles) and 2 TV-show sitemaps
 * (~12 000 series with slugs only), rebuilt every three days. A film is matched by normalised
 * title, then verified by IMDB id or year. A show is matched by normalised slug; its series
 * page has all episodes with video_resources.
 *
 * Desktop app only: the database cache lives there.
 */
import type { FileOption } from '../showbox';
import type { TmdbShow } from '../combinedEpisodes';
import { normalizeTitle } from '../metadata/types';
import { getOrderCache, saveOrderCache } from '../db/queries';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const INDEX_AGE = 3 * DAY;
const INDEX_KEY = 'tubi-index3';
const MOVIE_SITEMAPS = 8;
const SHOW_SITEMAPS = 2;

/* ------------------------------------------------ asking */

async function fetchPage(url: string): Promise<string> {
	const resp = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate, br' }, signal: AbortSignal.timeout(30_000) });
	if (!resp.ok) throw new Error(`${resp.status}`);
	return resp.text();
}

type TubiVideo = {
	id: number;
	title: string;
	type: string;
	year: number;
	imdb_id: string;
	video_resources: { type: string; codec: string; resolution: string; manifest: { url: string }; license_server?: { url: string } }[];
	subtitles: { url: string; lang: string }[];
};

function parsePageData(html: string): Record<string, TubiVideo> {
	const m = html.match(/window\.__data\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
	if (!m) return {};
	try {
		return JSON.parse(m[1].replace(/\bundefined\b/g, 'null'))?.video?.byId ?? {};
	} catch {
		return {};
	}
}

/* ------------------------------------------------ the list of what it has */

type Film = [string, string, string];
type Named = [string, string];
type Index = { films: Film[]; shows: Named[] };

let index: { at: number; films: Map<string, string[]>; shows: Map<string, string[]> } | null = null;
let building: Promise<void> | null = null;
let failedAt = 0;

const nameKey = (title: string) => normalizeTitle(title);

function load(saved: Index, at: number) {
	const films = new Map<string, string[]>();
	for (const [id, title, slug] of saved.films) {
		const add = (key: string) => { if (key) films.set(key, [...(films.get(key) ?? []), id]); };
		add(nameKey(title));
		const slugKey = nameKey(slug.replace(/-/g, ' '));
		if (slugKey !== nameKey(title)) add(slugKey);
	}
	const shows = new Map<string, string[]>();
	for (const [id, slug] of saved.shows) {
		const key = nameKey(slug.replace(/-/g, ' '));
		shows.set(key, [...(shows.get(key) ?? []), id]);
	}
	index = { at, films, shows };
}

async function build(): Promise<void> {
	const started = Date.now();
	const films = new Map<string, [string, string]>();
	for (let i = 1; i <= MOVIE_SITEMAPS; i++) {
		try {
			const xml = await fetchPage(`https://tubitv.com/sitemaps/movies-${i}.xml`);
			let found = 0;
			for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
				const loc = block[1].match(/<loc>https:\/\/tubitv\.com\/movies\/(\d+)\/([^<]+)<\/loc>/);
				if (!loc) continue;
				const title = block[1].match(/<video:title><!\[CDATA\[(.+?)\]\]><\/video:title>/);
				films.set(loc[1], [title?.[1] ?? loc[2].replace(/-/g, ' '), loc[2]]);
				found++;
			}
			if (!found) break;
		} catch {
			if (i === 1) throw new Error('could not fetch the first movie sitemap');
		}
	}
	const shows = new Map<string, string>();
	for (let i = 1; i <= SHOW_SITEMAPS; i++) {
		try {
			const xml = await fetchPage(`https://tubitv.com/sitemaps/tv-shows-${i}.xml`);
			for (const m of xml.matchAll(/<loc>https:\/\/tubitv\.com\/series\/(\d+)\/([^<]+)<\/loc>/g)) {
				shows.set(m[1], m[2]);
			}
		} catch {
			if (i === 1 && !films.size) throw new Error('could not fetch sitemaps');
		}
	}
	const before = getOrderCache(INDEX_KEY)?.value as Index | undefined;
	for (const [id, title, slug] of before?.films ?? []) if (!films.has(id)) films.set(id, [title, slug]);
	for (const [id, slug] of before?.shows ?? []) if (!shows.has(id)) shows.set(id, slug);
	const saved: Index = { films: [...films].map(([id, [title, slug]]) => [id, title, slug] as Film), shows: [...shows] };
	const at = Date.now();
	saveOrderCache(INDEX_KEY, saved, at);
	load(saved, at);
	console.log(`[tubi] listed ${films.size} films + ${shows.size} shows in ${Math.round((Date.now() - started) / 1000)} s`);
}

function readIndex(): typeof index {
	if (!index) {
		const kept = getOrderCache(INDEX_KEY);
		if (kept) load(kept.value as Index, kept.at);
	}
	const old = !index || Date.now() - index.at > INDEX_AGE;
	if (old && !building && Date.now() - failedAt > HOUR) {
		building = build()
			.catch((error) => {
				failedAt = Date.now();
				console.warn('[tubi] could not list:', error instanceof Error ? error.message : error);
			})
			.finally(() => (building = null));
	}
	return index;
}

async function indexWithin(wait: number): Promise<typeof index> {
	const now = readIndex();
	if (now || !building) return now;
	await Promise.race([building, new Promise((r) => setTimeout(r, wait))]);
	return index;
}

/* ------------------------------------------------ one title */

const pageCache = new Map<string, { at: number; videos: Record<string, TubiVideo> }>();
const episodeHome = new Map<string, string>();

async function videosOf(url: string, cacheKey: string, fresh = false): Promise<Record<string, TubiVideo>> {
	const kept = pageCache.get(cacheKey);
	if (kept && !fresh && Date.now() - kept.at < 40 * 60 * 1000) return kept.videos;
	try {
		const html = await fetchPage(url);
		const videos = parsePageData(html);
		if (Object.keys(videos).length) {
			pageCache.set(cacheKey, { at: Date.now(), videos });
			for (const id of Object.keys(videos)) episodeHome.set(id, cacheKey);
		}
		return videos;
	} catch {
		return {};
	}
}

async function movieOf(id: string, fresh = false): Promise<TubiVideo | null> {
	const videos = await videosOf(`https://tubitv.com/movies/${id}`, `m-${id}`, fresh);
	return videos[id] ?? null;
}

async function seriesOf(id: string, slug: string, fresh = false): Promise<{ series: TubiVideo | null; episodes: TubiVideo[] }> {
	const videos = await videosOf(`https://tubitv.com/series/${id}/${slug}`, `s-${id}`, fresh);
	let series: TubiVideo | null = null;
	const episodes: TubiVideo[] = [];
	for (const v of Object.values(videos)) {
		if (v.type === 's') series = v;
		else if (v.type === 'v') episodes.push(v);
	}
	return { series, episodes };
}

type TubiCopy = { manifest: string; resolution: string };

function bestStream(video: TubiVideo): TubiCopy | null {
	const plain = (video.video_resources ?? []).filter((r) => r.type === 'hlsv6' && r.codec?.toUpperCase() === 'H264' && r.manifest?.url);
	if (!plain.length) return null;
	const prefer = ['720P', '576P', '480P', '1080P'];
	plain.sort((a, b) => {
		const ai = prefer.indexOf(a.resolution), bi = prefer.indexOf(b.resolution);
		return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
	});
	return { manifest: plain[0].manifest.url, resolution: plain[0].resolution };
}

const quality = (resolution: string) => {
	const h = parseInt(resolution);
	if (h >= 1000) return '1080p';
	if (h >= 700) return '720p';
	if (h >= 500) return '576p';
	return 'SD';
};

export const tubiShareKey = (id: string) => `tubi:${id}`;

export function parseTubiShareKey(shareKey: string): string | null {
	return shareKey.match(/^tubi:(\d+)$/)?.[1] ?? null;
}

function makeCopy(id: string, stream: TubiCopy): FileOption {
	return { fid: -31, quality: quality(stream.resolution), name: 'Tubi', size: '', source: 'Tubi', shareKey: tubiShareKey(id) };
}

/* ------------------------------------------------ films */

export async function tubiFilm(title: string, year: string, wait = 3000, imdbId?: string): Promise<FileOption[]> {
	if (typeof process.send !== 'function') return [];
	try {
		const listed = await indexWithin(wait);
		const ids = listed?.films.get(nameKey(title)) ?? [];
		if (!ids.length) return [];
		const wanted = Number(year);
		for (const id of ids.slice(0, 4)) {
			const video = await movieOf(id);
			if (!video) continue;
			if (imdbId && video.imdb_id && video.imdb_id !== imdbId) continue;
			if (!imdbId && wanted && video.year && Math.abs(video.year - wanted) > 1) continue;
			const stream = bestStream(video);
			if (stream) return [makeCopy(id, stream)];
		}
	} catch (error) {
		console.warn('[tubi] could not look for a film:', error);
	}
	return [];
}

/* ------------------------------------------------ TV shows */

function parseEpisode(title: string): { season: number; episode: number } | null {
	const m = title.match(/S(\d+):E(\d+)/);
	return m ? { season: parseInt(m[1]), episode: parseInt(m[2]) } : null;
}

export async function tubiFiles(show: TmdbShow, wait: number): Promise<Map<string, FileOption[]>> {
	const out = new Map<string, FileOption[]>();
	if (typeof process.send !== 'function') return out;
	const work = (async () => {
		const listed = await indexWithin(wait);
		const ids = listed?.shows.get(nameKey(show.name)) ?? [];
		if (!ids.length) return;
		for (const id of ids.slice(0, 2)) {
			const slug = (getOrderCache(INDEX_KEY)?.value as Index | undefined)
				?.shows.find(([sid]) => sid === id)?.[1] ?? '';
			const { series, episodes } = await seriesOf(id, slug);
			if (!episodes.length) continue;
			if (series?.imdb_id && show.seasons[0]?.airDate) {
				const started = Number(show.seasons.find((s) => s.number === 1)?.airDate?.slice(0, 4)) || 0;
				if (series.year && started && Math.abs(series.year - started) > 2) continue;
			}
			const first = episodes[0];
			const stream = bestStream(first);
			if (!stream) continue;
			for (const ep of episodes) {
				const parsed = parseEpisode(ep.title);
				if (!parsed) continue;
				const tmdbSeason = show.seasons.find((s) => s.number === parsed.season);
				if (!tmdbSeason || parsed.episode < 1 || parsed.episode > tmdbSeason.count) continue;
				out.set(`${parsed.season}-${parsed.episode}`, [makeCopy(String(ep.id), stream)]);
			}
			if (out.size) break;
		}
	})().catch((error) => console.warn('[tubi] could not list a show:', error));
	await Promise.race([work, new Promise((r) => setTimeout(r, wait))]);
	return new Map(out);
}

/* ------------------------------------------------ streaming */

function cachedVideo(id: string): TubiVideo | null {
	const home = episodeHome.get(id);
	if (home) return pageCache.get(home)?.videos[id] ?? null;
	return pageCache.get(`m-${id}`)?.videos[id] ?? null;
}

export async function tubiStream(shareKey: string, refresh = false): Promise<{ url: string; why: string }> {
	const id = parseTubiShareKey(shareKey);
	if (!id) return { url: '', why: 'Not a Tubi copy' };
	let video: TubiVideo | null = refresh ? null : cachedVideo(id);
	if (!video) {
		const videos = await videosOf(`https://tubitv.com/tv-shows/${id}`, `e-${id}`, refresh);
		video = videos[id] ?? null;
		if (!video) video = await movieOf(id, refresh);
	}
	if (!video) return { url: '', why: 'Tubi did not answer' };
	const stream = bestStream(video);
	if (!stream) return { url: '', why: 'Tubi has no playable copy of this' };
	return { url: stream.manifest, why: '' };
}

export function tubiSubtitles(shareKey: string): Promise<{ id: string; url: string; lang: string; language: string; fileName: string; source: string; default?: boolean }[]> {
	const id = parseTubiShareKey(shareKey);
	if (!id) return Promise.resolve([]);
	const findVideo = async (): Promise<TubiVideo | null> => {
		const cached = cachedVideo(id);
		if (cached) return cached;
		const videos = await videosOf(`https://tubitv.com/tv-shows/${id}`, `e-${id}`);
		return videos[id] ?? await movieOf(id);
	};
	return findVideo().then((video) => {
		if (!video?.subtitles?.length) return [];
		const sub = video.subtitles.find((s) => /^en/i.test(s.lang)) ?? video.subtitles[0];
		if (!sub?.url) return [];
		const english = /^en/i.test(sub.lang);
		return [{
			id: `tubi-${id}`,
			url: sub.url,
			lang: english ? 'en' : sub.lang.slice(0, 2).toLowerCase(),
			language: english ? 'English' : sub.lang,
			fileName: 'Tubi captions',
			source: 'Tubi',
			default: english
		}];
	});
}

/* ------------------------------------------------ wiring */

export function withTubi(files: FileOption[], tubi: FileOption[]): FileOption[] {
	if (!tubi.length) return files;
	const at = files.findIndex((f) => f.source === 'Movy' || f.source === 'Vidfast');
	return at < 0 ? [...files, ...tubi] : [...files.slice(0, at), ...tubi, ...files.slice(at)];
}

export async function onTubi(title: string, type: string, year: string): Promise<boolean> {
	if (typeof process.send !== 'function') return false;
	if (type === 'movie') return (await tubiFilm(title, year, 5 * 60 * 1000)).length > 0;
	const listed = await indexWithin(5 * 60 * 1000);
	return (listed?.shows.get(nameKey(title)) ?? []).length > 0;
}

export function warmTubi(): void {
	readIndex();
}
