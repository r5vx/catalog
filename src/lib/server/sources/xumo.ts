/**
 * Xumo Play (play.xumo.com): Comcast's free films and TV, with adverts. United States only.
 *
 * It has no search, so Catalog keeps its own list of what Xumo has, by name, made from the same
 * listings its apps show: every channel on any of its channel lists (the web app's and its TV
 * apps'), each channel's rows ("Most Popular", "Horror", "Full Collection"…), 50 titles a page (a
 * row gives 300 at most). Channels on no list still answer by their number, so every number near a
 * listed one is asked too, and near the ones in MORE_THOUSANDS. Measured 2026-11-24: 12,574 films
 * and 2,995 shows from the listed channels; 4,285 and 1,017 more from 269 unlisted channels beside
 * them; 8,662 and 618 more from 13 channels further off, nearly all from two (88882997 and
 * 88882998: 396 and 401 rows with names like "Filmrise Movies - Google Freeplay VOD"). About
 * 25,000 asks, a few minutes,
 * all in the background; kept in the library and made again every three days, keeping what earlier
 * lists had.
 *
 * Still not everything need be in a row: House Shark was in none until 88882997 was found. Xumo's
 * search address (/assets/assets.json?q=) answers but finds nothing, so a film in no row is only
 * listed when added by hand (KNOWN_FILMS).
 *
 * A film is matched by name, then the year Xumo gives it (`originalReleaseYear`, one year either
 * way). A show by name (Xumo writes "Shark Hunters ('13)" for a second one of that name), then
 * its own season and episode numbers, wherever TMDB's season has that many.
 *
 * Its videos are plain HLS from its own servers (live-content.xumo.com), 720p at most, no locks.
 * The adverts aren't in the video: Xumo's player adds them at the cue points it's given, so they
 * never play here. About 1 in 15 titles is DRM-locked (Widevine/PlayReady, a DASH copy only);
 * those are left out. The video comes through Catalog's relay, so phones and TVs play it too.
 */
import type { FileOption } from '../showbox';
import type { TmdbShow } from '../combinedEpisodes';
import { normalizeTitle, withoutQualifier } from '../metadata/types';
import { getOrderCache, saveOrderCache } from '../db/queries';
import { trustVideoHost } from '../relayHosts';

const API = 'https://valencia-app-mds.xumo.com/v2';
/** The channel list its web app shows (and the "geo" id it asks with), and its Movies and TV pages. */
const CHANNEL_LIST = '/proxy/channels/list/10006.json?sort=hybrid&geoId=2f08a9b3';
const PAGES = ['99991334', '9999699'];
/**
 * Thousands of channel numbers with channels in them that no list names, found by asking every
 * number from 8880000 to 8889999, 9990000 to 9999999, 88800000 to 88899999 and 99900000 to
 * 99999999 on 2026-11-24 (25 minutes: too long for every time the list is made).
 */
const MORE_THOUSANDS = [9991, 9992, 9993, 88810, 88882, 88883, 99913, 99995, 99996];
/**
 * Films Xumo plays but lists in no row of any channel, found some other way (a web search). Add one
 * as [its id from the play.xumo.com address, its name].
 */
const KNOWN_FILMS: Named[] = [['XM0WAWB47BLDDR', 'House Shark']];
/** Its channel lists are numbered from 10000 (10006 is the web app's); 10000–10060 answered on 2026-11-23. */
const LISTS_TO = 100;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** What Xumo's video servers are asked with (they want nothing in particular). */
export const XUMO_HEADERS = { 'User-Agent': UA };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** How old the list may get before it's made again (the old one is used meanwhile). */
const INDEX_AGE = 3 * DAY;
const INDEX_KEY = 'xumo-index1';

/* ------------------------------------------------ asking */

async function ask<T>(path: string): Promise<T | null> {
	try {
		const response = await fetch(API + path, { headers: { 'User-Agent': UA, Origin: 'https://play.xumo.com' }, signal: AbortSignal.timeout(20_000) });
		if (response.status === 204 || !response.ok) return null;
		return (await response.json()) as T;
	} catch {
		return null;
	}
}

/* ------------------------------------------------ the list of what it has */

/** [Xumo id, its name]. */
type Named = [string, string];
/** `numbered`: made with the channels on no list too; a list from before that is made again at once. */
type Index = { films: Named[]; shows: Named[]; numbered?: boolean };

type Listed = { id: string; connectorId?: string; contentType: string; title: string };

let index: { at: number; numbered: boolean; films: Map<string, string[]>; shows: Map<string, Named[]> } | null = null;
let building: Promise<void> | null = null;
let failedAt = 0;

/** A name as it's looked up: plain words, any "(2013)" or "('13)" off. */
const nameKey = (title: string) => normalizeTitle(withoutQualifier(title).replace(/\s*\('?\d{2}\)\s*$/, ''));

function load(saved: Index, at: number) {
	const films = new Map<string, string[]>();
	const known = new Set(saved.films.map(([id]) => id));
	for (const [id, title] of [...saved.films, ...KNOWN_FILMS.filter(([id]) => !known.has(id))]) {
		const key = nameKey(title);
		films.set(key, [...(films.get(key) ?? []), id]);
	}
	const shows = new Map<string, Named[]>();
	for (const [id, title] of saved.shows) {
		const key = nameKey(title);
		shows.set(key, [...(shows.get(key) ?? []), [id, title]]);
	}
	index = { at, numbered: saved.numbered === true, films, shows };
}

/** Every network's rows, page by page, six asks at a time. */
async function build(): Promise<void> {
	const started = Date.now();
	type Channels = { channel?: { item?: { guid?: { value?: string } }[] } };
	const list = await ask<Channels>(CHANNEL_LIST);
	if (!list?.channel?.item?.length) throw new Error('no channel list (outside the United States?)');
	// Its other channel lists too (its TV apps', by number): 326 more channels on 2026-11-23, among them
	// "Movies Page - NON DRM" and a second set of "Xumo Free …" channels. A channel with no videos to
	// pick just has no rows.
	const lists = await Promise.all(Array.from({ length: LISTS_TO }, (_, i) => (i === 6 ? list : ask<Channels>(CHANNEL_LIST.replace('10006', String(10000 + i))))));
	const listed = [...new Set([...PAGES, ...lists.flatMap((l) => (l?.channel?.item ?? []).map((c) => c.guid?.value ?? ''))])].filter(Boolean);
	// Channels on no list: every number in MORE_THOUSANDS and in each thousand a listed channel is in (13 on
	// 2026-11-24). Most numbers are no channel and answer at once with nothing.
	const thousands = new Set([...MORE_THOUSANDS, ...listed.filter((c) => /^\d+$/.test(c)).map((c) => Math.floor(Number(c) / 1000))]);
	const channels = [...new Set([...listed, ...[...thousands].flatMap((t) => Array.from({ length: 1000 }, (_, i) => String(t * 1000 + i)))])];

	type Categories = { categories?: { categoryId: string; hits: number }[] };
	const seenCategories = new Set<string>();
	const pages: string[] = [];
	const queue = [...channels];
	const work = async (next: () => Promise<void>, atOnce = 6) => {
		await Promise.all(Array.from({ length: atOnce }, next));
	};
	let withRows = 0;
	await work(async () => {
		while (queue.length) {
			const channel = queue.shift()!;
			const found = await ask<Categories>(`/channels/channel/${channel}/categories.json`);
			if (found?.categories?.length) withRows++;
			for (const c of found?.categories ?? []) {
				if (seenCategories.has(c.categoryId)) continue;
				seenCategories.add(c.categoryId);
				for (let offset = 0; offset < (c.hits || 0); offset += 50) {
					pages.push(`/categories/category/${c.categoryId}.json?f=asset.title&f=asset.connectorId&limit=50&offset=${offset}`);
				}
			}
		}
	}, 16);

	const films = new Map<string, string>();
	const shows = new Map<string, string>();
	let answered = 0;
	await work(async () => {
		while (pages.length) {
			const page = await ask<{ results?: Listed[] }>(pages.shift()!);
			if (page) answered++;
			for (const r of page?.results ?? []) {
				if (!r.id || !r.title) continue;
				if (r.contentType === 'MOVIE') films.set(r.id, r.title);
				else if (r.contentType === 'SERIES') shows.set(r.id, r.title);
				// An episode names its show (connectorId); the show itself may be in no row.
				else if (r.contentType === 'EPISODIC' && r.connectorId && r.connectorId !== r.id) shows.set(r.connectorId, r.title);
			}
		}
	});
	if (!films.size || answered < 50) throw new Error(`only ${answered} pages answered`);
	// Titles seen before stay: rows like "Most Popular" and "Leaving Soon" change, and a film out of
	// every row can still be played by its id (House Shark was in none on 2026-11-23). One that has
	// really gone is found out when it's looked up (no answer, or no copy), and isn't listed.
	const before = getOrderCache(INDEX_KEY)?.value as Index | undefined;
	for (const [id, title] of before?.films ?? []) if (!films.has(id)) films.set(id, title);
	for (const [id, title] of before?.shows ?? []) if (!shows.has(id)) shows.set(id, title);
	for (const [id, title] of KNOWN_FILMS) films.set(id, title);
	const saved: Index = { films: [...films], shows: [...shows], numbered: true };
	const at = Date.now();
	saveOrderCache(INDEX_KEY, saved, at);
	load(saved, at);
	console.log(`[xumo] listed ${films.size} films and ${shows.size} shows from ${withRows} networks (${listed.length} on its lists) in ${Math.round((Date.now() - started) / 1000)} s`);
}

/** The list, made (or made again, in the background) when it's missing or old. */
function readIndex(): typeof index {
	if (!index) {
		const kept = getOrderCache(INDEX_KEY);
		if (kept) load(kept.value as Index, kept.at);
	}
	const old = !index || !index.numbered || Date.now() - index.at > INDEX_AGE;
	if (old && !building && Date.now() - failedAt > HOUR) {
		building = build()
			.catch((error) => {
				failedAt = Date.now();
				console.warn('[xumo] could not list:', error instanceof Error ? error.message : error);
			})
			.finally(() => (building = null));
	}
	return index;
}

/** The list, waiting up to `wait` ms for it the first time it's made. */
async function indexWithin(wait: number): Promise<typeof index> {
	const now = readIndex();
	if (now || !building) return now;
	await Promise.race([building, new Promise((r) => setTimeout(r, wait))]);
	return index;
}

/* ------------------------------------------------ one title */

type Source = { uri: string; height?: number; produces?: string; drm?: Record<string, unknown> };
type Asset = {
	id: string;
	title?: string;
	contentType?: string;
	originalReleaseYear?: number;
	providers?: { title?: string; sources?: Source[]; captions?: { url: string; type?: string; lang?: string }[] }[];
	seasons?: { season: number; episodes?: { id: string; episode: number; episodeTitle?: string }[] }[];
};

const assets = new Map<string, { at: number; asset: Asset | null }>();

async function assetOf(id: string, fields: string, fresh = false): Promise<Asset | null> {
	const key = `${id}|${fields}`;
	const kept = assets.get(key);
	if (kept && !fresh && Date.now() - kept.at < 6 * HOUR) return kept.asset;
	const asset = await ask<Asset>(`/assets/asset/${id}.json?${fields}`);
	// Not kept when there was no answer, so it's asked again next time.
	if (asset) assets.set(key, { at: Date.now(), asset });
	return asset;
}

const FILM_FIELDS = 'f=title&f=originalReleaseYear&f=providers';
const SHOW_FIELDS = 'f=title&f=season:all&f=episodes.episodeTitle';

/** Its plain HLS copy, the sharpest; none when it only has a locked (DRM) one. */
function clearCopy(asset: Asset | null): Source | null {
	const sources = asset?.providers?.[0]?.sources ?? [];
	const clear = sources.filter((s) => s.uri && s.produces === 'application/x-mpegURL' && !(s.drm && Object.keys(s.drm).length));
	return clear.sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0] ?? null;
}

const quality = (source: Source) => (source.height ? `${source.height >= 1000 ? 1080 : source.height >= 700 ? 720 : source.height}p` : 'HD');

/** A Xumo copy's share key: `xumo:<its id>` (a film's, or one episode's). */
export const xumoShareKey = (id: string) => `xumo:${id}`;

export function parseXumoShareKey(shareKey: string): string | null {
	return shareKey.match(/^xumo:(XM[0-9A-Z]{8,20})$/)?.[1] ?? null;
}

function copy(id: string, source: Source, name: string): FileOption {
	return { fid: -30, quality: quality(source), name, size: '', source: 'Xumo Play', shareKey: xumoShareKey(id) };
}

/**
 * Xumo's copy of a film, by its name and year, or none. Waits up to `wait` ms for the list the
 * first time it's made (it's ready in a couple of minutes, and kept after).
 */
export async function xumoFilm(title: string, year: string, wait = 3000): Promise<FileOption[]> {
	try {
		const listed = await indexWithin(wait);
		const ids = listed?.films.get(nameKey(title)) ?? [];
		if (!ids.length) return [];
		const wanted = Number(year);
		for (const id of ids.slice(0, 6)) {
			const asset = await assetOf(id, FILM_FIELDS);
			const at = asset?.originalReleaseYear;
			// Without a year on one side, only when there's just the one of that name.
			if (wanted && at ? Math.abs(at - wanted) > 1 : ids.length > 1) continue;
			// (Several of one name with no year to tell them apart: none, rather than the wrong film.)
			const source = clearCopy(asset);
			if (source) return [copy(id, source, 'Xumo Play')];
		}
	} catch (error) {
		console.warn('[xumo] could not look for a film:', error);
	}
	return [];
}

/** The year a show's name gives, if it has one ("Shark Hunters ('13)" → 2013). */
function yearInName(title: string): number | null {
	const m = title.match(/\((\d{4})\)\s*$/) ?? title.match(/\('(\d{2})\)\s*$/);
	if (!m) return null;
	const n = Number(m[1]);
	return m[1].length === 4 ? n : n > 40 ? 1900 + n : 2000 + n;
}

/**
 * Xumo's copies of a show's episodes, by "season-episode" (Xumo's numbers, where TMDB's season
 * has that many). A show locked by DRM (judged by its first episode) has none. At most `wait` ms.
 */
export async function xumoFiles(show: TmdbShow, wait: number): Promise<Map<string, FileOption[]>> {
	const out = new Map<string, FileOption[]>();
	const work = (async () => {
		const listed = await indexWithin(wait);
		const named = listed?.shows.get(nameKey(show.name)) ?? [];
		if (!named.length) return;
		const started = Number(show.seasons.find((s) => s.number === 1)?.airDate?.slice(0, 4)) || 0;
		// Two of one name: the one whose name gives the year the show started, else the one without a year.
		const pick =
			named.length === 1
				? named[0]
				: (named.find(([, t]) => started && yearInName(t) !== null && Math.abs(yearInName(t)! - started) <= 1) ??
					named.find(([, t]) => yearInName(t) === null));
		if (!pick) return;
		const series = await assetOf(pick[0], SHOW_FIELDS);
		const seasons = series?.seasons ?? [];
		const first = seasons[0]?.episodes?.[0];
		if (!first) return;
		const source = clearCopy(await assetOf(first.id, FILM_FIELDS));
		if (!source) return;
		for (const season of seasons) {
			const tmdb = show.seasons.find((s) => s.number === season.season);
			if (!tmdb) continue;
			for (const e of season.episodes ?? []) {
				if (!(e.episode >= 1 && e.episode <= tmdb.count)) continue;
				out.set(`${season.season}-${e.episode}`, [copy(e.id, source, `Xumo Play`)]);
			}
		}
	})().catch((error) => console.warn('[xumo] could not list a show:', error));
	await Promise.race([work, new Promise((r) => setTimeout(r, wait))]);
	return new Map(out);
}

/**
 * Whether Xumo has a title, for the Watch button's check: a film by name and year, a show by name.
 * The very first time, it waits for the list to be made (a few minutes): a "no" is kept an hour,
 * and one said only because the list wasn't ready would hide the title that long. (The button
 * doesn't wait on it: it says "not sure yet" after 12 s and asks again.)
 */
export async function onXumo(title: string, type: string, year: string, show: () => Promise<TmdbShow | null>, pilot?: (listed: boolean) => void): Promise<boolean> {
	const wait = 5 * 60 * 1000;
	if (type === 'movie') return (await xumoFilm(title, year, wait)).length > 0;
	const found = await show();
	if (!found) return false;
	const files = await xumoFiles(found, wait);
	pilot?.(files.has('1-1'));
	return files.size > 0;
}

/**
 * The playlist for a Xumo copy, through the relay, or why not. Asked afresh on `refresh` (its
 * addresses don't expire, but a title can leave Xumo).
 */
export async function xumoStream(shareKey: string, refresh = false): Promise<{ url: string; why: string }> {
	const id = parseXumoShareKey(shareKey);
	if (!id) return { url: '', why: 'Not a Xumo Play copy' };
	const asset = await assetOf(id, FILM_FIELDS, refresh);
	if (!asset) return { url: '', why: 'Xumo Play did not answer' };
	const source = clearCopy(asset);
	if (!source) return { url: '', why: asset.providers?.length ? 'Xumo Play only has a locked copy of this' : 'Xumo Play no longer has this' };
	trustVideoHost(source.uri, 'xumo');
	return { url: `/api/watch/relay?u=${encodeURIComponent(source.uri)}`, why: '' };
}

/**
 * The captions Xumo has for its copy (English, timed to that very copy), first and on by
 * themselves while it plays. An SRT file where it has one, else WebVTT.
 */
export async function xumoSubtitles(shareKey: string): Promise<{ id: string; url: string; lang: string; language: string; fileName: string; source: string; default?: boolean }[]> {
	const id = parseXumoShareKey(shareKey);
	if (!id) return [];
	const captions = (await assetOf(id, FILM_FIELDS))?.providers?.[0]?.captions ?? [];
	const file = captions.find((c) => /\.srt$/i.test(c.url)) ?? captions.find((c) => /\.vtt$/i.test(c.url));
	if (!file) return [];
	const english = !file.lang || /^en/i.test(file.lang);
	return [{
		id: `xumo-${id}`,
		url: file.url,
		lang: english ? 'en' : file.lang!.slice(0, 2).toLowerCase(),
		language: english ? 'English' : file.lang!,
		fileName: 'Xumo Play captions',
		source: 'Xumo Play',
		default: english
	}];
}

/**
 * A list of copies with Xumo's put in after 7Movies' and before Movy's and Vidfast's: Xumo's is
 * known to be there (it's in the list), while theirs are listed without asking and found slowly.
 */
export function withXumo(files: FileOption[], xumo: FileOption[]): FileOption[] {
	if (!xumo.length) return files;
	const at = files.findIndex((f) => f.source === 'Movy' || f.source === 'Vidfast');
	return at < 0 ? [...files, ...xumo] : [...files.slice(0, at), ...xumo, ...files.slice(at)];
}

/** Starts making the list if it's missing or old (nothing waits on it). */
export function warmXumo(): void {
	readIndex();
}
