/**
 * Stremio addons (owner, 2026-11-15: asked for on Reddit, "I will leave Stremio in a heartbeat").
 * Someone pastes an addon's install link in Settings → Services (the manifest.json address, or
 * the stremio:// link its page gives). Every addon that has streams for films or shows then gives
 * every film and episode two more copies, "<addon> 1080p" and "<addon> 4K", after a debrid
 * service's and before the free sites (combinedEpisodes.ts `unasked`).
 *
 * Picked, a copy is found like this:
 *   1. The addon is asked for its streams by the title's IMDb id (`tt123:1:2` for an episode), or
 *      TMDB id (`tmdb:123`) for an addon that only takes those. That's the Stremio addon protocol:
 *      GET <addon>/stream/<movie|series>/<id>.json → { streams: [...] }.
 *   2. Each stream's name and description say its quality, size and sound, and the same filters
 *      and order as debrid's are used (debrid.ts `ranked`: no Dolby/DTS sound, which Electron
 *      plays silent; AAC first...).
 *   3. A stream with a web address plays: a plain file as it is, a playlist (.m3u8) through the
 *      relay, with the headers the addon said to use. Debrid addons (Torrentio with a key,
 *      AIOStreams, Comet, MediaFusion) give addresses like that; ones marked not downloaded yet
 *      ("[RD download]", "⏳") are left out, ones marked ready ("[RD+]", "⚡") come first.
 *   4. A stream that's only a torrent (Torrentio without a key) plays when a debrid service is set
 *      up: it's handed to it (debrid.ts `readyLink`). Catalog itself never downloads torrents.
 *   YouTube and "open in a browser" streams are left out.
 *
 * Lists (2026-11-15 evening): an addon can also have lists of films and shows ("catalogs" in
 * Stremio: Trakt lists, TMDB Discover+, an anime site's seasonal list...). Each list that needs
 * nothing typed in becomes a row at the bottom of Browse (`addonShelves`), with Show more where
 * the addon can page. Their entries are IMDb ids, turned into TMDB titles (`/find`, kept 30
 * days in watch_order_cache) so they open like any other title; ones TMDB doesn't know are left
 * out. An addon with only lists (no streams) can be added too.
 *
 * Addon links can hold someone's own keys (a configured Torrentio has the debrid key in it), so
 * they're kept in `settings`, which is never exported, and never shown in full or logged.
 * Found links are kept 30 minutes, "nothing" 10 minutes.
 */
import { createHash } from 'node:crypto';
import type { FileOption } from '../showbox';
import { readSettings, updateSettings } from '../settings';
import { tmdbGet, toResult, type TmdbItem } from '../metadata/tmdb';
import type { SearchResult } from '../metadata/types';
import { getOrderCache, saveOrderCache } from '../db/queries';
import { trustAddonHost } from '../relayHosts';
import { debridSetting, ranked, readyLink, type Release } from './debrid';

export type Addon = {
	/** The address everything is asked under (the install link without /manifest.json). */
	base: string;
	/** Short and steady: picks the addon out in a copy's share key, without its address in it. */
	key: string;
	name: string;
	/** Which ids it takes for streams: IMDb's ("tt") or TMDB's ("tmdb:"). */
	ids: 'tt' | 'tmdb';
	movies: boolean;
	shows: boolean;
	/** False for an addon with only lists. (Saved before lists came: has streams.) */
	streams?: boolean;
	/** Its lists that need nothing typed in; `pages`: it can give more after the first. */
	catalogs?: AddonCatalog[];
};

export type AddonCatalog = { type: 'movie' | 'series'; id: string; name: string; pages: boolean };

type What = { type: 'tv' | 'movie'; id: number; season: number; episode: number };
type Wanted = '1080p' | '2160p';
const MINUTE = 60 * 1000;

/* ------------------------------------------------ the saved list */

export function savedAddons(): Addon[] {
	try {
		const list = JSON.parse(readSettings().stremioAddons ?? '[]');
		return Array.isArray(list) ? list.filter((a) => a && typeof a.base === 'string' && typeof a.key === 'string') : [];
	} catch {
		return [];
	}
}

const keyOf = (base: string) => createHash('sha1').update(base).digest('hex').slice(0, 8);

/** The install link as https, without manifest.json: stremio://x/y/manifest.json → https://x/y. */
export function addonBase(link: string): string | null {
	let text = link.trim();
	if (text.startsWith('stremio://')) text = `https://${text.slice('stremio://'.length)}`;
	try {
		const url = new URL(text);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
		url.hash = '';
		url.search = '';
		return url.href.replace(/\/manifest\.json$/i, '').replace(/\/+$/, '');
	} catch {
		return null;
	}
}

type Resource = string | { name?: string; types?: string[]; idPrefixes?: string[] };
type ManifestCatalog = {
	type?: string;
	id?: string;
	name?: string;
	extra?: { name?: string; isRequired?: boolean }[];
	/** The older way of saying the same. */
	extraRequired?: string[];
	extraSupported?: string[];
};
type Manifest = {
	id?: string;
	name?: string;
	types?: string[];
	idPrefixes?: string[];
	resources?: Resource[];
	catalogs?: ManifestCatalog[];
	behaviorHints?: { configurationRequired?: boolean; configurable?: boolean };
};

/** An install link checked: the addon it is, or why it can't be used. */
export async function readAddon(link: string): Promise<{ addon: Addon } | { error: string }> {
	const base = addonBase(link);
	if (!base) return { error: "That isn't an addon link. It ends in manifest.json." };
	let manifest: Manifest;
	try {
		const response = await fetch(`${base}/manifest.json`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
		if (!response.ok) return { error: `The addon answered ${response.status}.` };
		manifest = await response.json();
	} catch {
		return { error: "The addon couldn't be reached, or that isn't an addon link." };
	}
	if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.resources)) return { error: "That link doesn't lead to a Stremio addon." };
	if (manifest.behaviorHints?.configurationRequired) return { error: 'This addon has to be set up on its own page first. Paste the link it gives after that.' };

	const name = String(manifest.name ?? 'Addon').slice(0, 40);
	const resources = manifest.resources.map((r) => (typeof r === 'string' ? { name: r } : r));
	const stream = resources.find((r) => r.name === 'stream');
	const types = stream?.types ?? manifest.types ?? [];
	const prefixes = stream?.idPrefixes ?? manifest.idPrefixes;
	const ids = !prefixes || prefixes.includes('tt') ? 'tt' : prefixes.some((p) => p.startsWith('tmdb')) ? 'tmdb' : null;
	const movies = Boolean(stream && ids && types.includes('movie'));
	const shows = Boolean(stream && ids && types.includes('series'));
	const catalogs = resources.some((r) => r.name === 'catalog') ? catalogsOf(manifest) : [];

	if (!movies && !shows && !catalogs.length) {
		if (stream) return { error: `${name} only has streams for other things (live TV, channels...).` };
		return { error: `${name} has no streams or lists for films and shows (it may only add subtitles).` };
	}
	return { addon: { base, key: keyOf(base), name, ids: ids ?? 'tt', movies, shows, streams: movies || shows, catalogs } };
}

/** An addon's lists of films and shows that need nothing typed in (no search, no required genre). */
function catalogsOf(manifest: Manifest): AddonCatalog[] {
	const out: AddonCatalog[] = [];
	for (const c of manifest.catalogs ?? []) {
		if ((c.type !== 'movie' && c.type !== 'series') || typeof c.id !== 'string') continue;
		const required = [...(c.extra ?? []).filter((e) => e.isRequired).map((e) => e.name), ...(c.extraRequired ?? [])];
		if (required.length) continue;
		const pages = (c.extra ?? []).some((e) => e.name === 'skip') || (c.extraSupported ?? []).includes('skip');
		out.push({ type: c.type, id: c.id, name: String(c.name || c.id).slice(0, 60), pages });
	}
	return out.slice(0, 30);
}

/** Adds an addon at the end (one added again keeps its place, with what its manifest says now). */
export function addAddon(addon: Addon): void {
	const list = savedAddons();
	const at = list.findIndex((a) => a.key === addon.key);
	if (at >= 0) list[at] = addon;
	else list.push(addon);
	updateSettings({ stremioAddons: JSON.stringify(list) });
}

export function removeAddon(key: string): void {
	const list = savedAddons().filter((a) => a.key !== key);
	updateSettings({ stremioAddons: list.length ? JSON.stringify(list) : undefined });
}

/** Moves an addon one place up (its copies come before the ones after it). */
export function raiseAddon(key: string): void {
	const list = savedAddons();
	const at = list.findIndex((a) => a.key === key);
	if (at <= 0) return;
	[list[at - 1], list[at]] = [list[at], list[at - 1]];
	updateSettings({ stremioAddons: JSON.stringify(list) });
}

/** The address shown in Settings: its site only, since the rest can hold someone's keys. */
export const addonSite = (addon: Addon) => {
	try {
		return new URL(addon.base).host;
	} catch {
		return '';
	}
};

/* ------------------------------------------------ copies */

/** `addon:<key>:<1080p|2160p>:<tv|movie>:<TMDB id>:<season>:<episode>` */
export const addonShareKey = (addon: Addon, what: What, quality: Wanted) => `addon:${addon.key}:${quality}:${what.type}:${what.id}:${what.season}:${what.episode}`;

export function parseAddonShareKey(shareKey: string): (What & { quality: Wanted; key: string }) | null {
	const m = shareKey.match(/^addon:([a-f0-9]{8}):(1080p|2160p):(tv|movie):(\d+):(\d+):(\d+)$/);
	if (!m) return null;
	return { key: m[1], quality: m[2] as Wanted, type: m[3] as 'tv' | 'movie', id: Number(m[4]), season: Number(m[5]), episode: Number(m[6]) };
}

/** Each addon's two copies of a film or episode (fid -100 and below). */
export function addonCopies(what: What): FileOption[] {
	return savedAddons()
		.filter((a) => a.streams !== false && (what.type === 'movie' ? a.movies : a.shows))
		.flatMap((addon, i) => [
			{ fid: -100 - 2 * i, quality: '1080p', name: `${addon.name} 1080p`, size: '', source: addon.name, shareKey: addonShareKey(addon, what, '1080p') },
			{ fid: -101 - 2 * i, quality: '2160p', name: `${addon.name} 4K`, size: '', source: addon.name, shareKey: addonShareKey(addon, what, '2160p') }
		]);
}

/* ------------------------------------------------ an addon's streams */

export type AddonStream = {
	name?: string;
	title?: string;
	description?: string;
	url?: string;
	infoHash?: string;
	fileIdx?: number;
	ytId?: string;
	externalUrl?: string;
	behaviorHints?: { filename?: string; videoSize?: number; proxyHeaders?: { request?: Record<string, string> }; notWebReady?: boolean };
};

export type Candidate = Release & { url: string | null; headers: Record<string, string>; ready: boolean };

/** Not downloaded yet on the debrid service the addon uses: playing it would show a "downloading" video. */
const NOT_READY = /download\]|⏳|uncached|not cached/i;
/** Ready on it ("[RD+]", "⚡"). */
const READY = /\+\]|⚡|(^|[^n])cached/i;

/** A stream as a Candidate, or null when it can't be played here. */
export function candidateFrom(stream: AddonStream): Candidate | null {
	const text = [stream.name, stream.title, stream.description, stream.behaviorHints?.filename].filter(Boolean).join('\n');
	const url = typeof stream.url === 'string' && /^https?:\/\//i.test(stream.url) ? stream.url : null;
	const hash = typeof stream.infoHash === 'string' && /^[a-f0-9]{40}$/i.test(stream.infoHash) ? stream.infoHash.toLowerCase() : '';
	if (!url && !hash) return null;
	if (url && NOT_READY.test(text)) return null;
	const lower = text.toLowerCase();
	const quality = /2160p|\b4k\b|\buhd\b/.test(lower) ? '2160p' : /1080p/.test(lower) ? '1080p' : /720p/.test(lower) ? '720p' : /480p|360p|\bsd\b/.test(lower) ? '480p' : '';
	const size = text.match(/([\d.]+)\s*(GB|MB|GiB|MiB)\b/i);
	const bytes = stream.behaviorHints?.videoSize;
	const gb = typeof bytes === 'number' && bytes > 0 ? bytes / 1024 ** 3 : size ? Number(size[1]) / (/^m/i.test(size[2]) ? 1024 : 1) : 0;
	const flags = text.match(/\p{Regional_Indicator}{2}/gu) ?? [];
	return {
		url,
		headers: stream.behaviorHints?.proxyHeaders?.request ?? {},
		ready: READY.test(text),
		hash,
		fileIdx: Number.isInteger(stream.fileIdx) ? (stream.fileIdx as number) : null,
		filename: stream.behaviorHints?.filename ?? '',
		name: (stream.title ?? stream.description ?? stream.name ?? '').split('\n')[0].trim(),
		// (480p and lower never fit a copy; `ranked` leaves them out.)
		quality: quality as Release['quality'],
		gb,
		seeders: Number(text.match(/👤\s*(\d+)/u)?.[1] ?? 0),
		otherLanguages: flags.some((f) => f !== '🇬🇧' && f !== '🇺🇸' && f !== '🇯🇵') || /(dual|multi) audio/i.test(text)
	};
}

/** Best first: `ranked`'s order, with streams marked ready before the rest. */
export function rankedCandidates(list: Candidate[], wanted: Wanted, kind: 'tv' | 'movie'): Candidate[] {
	const order = ranked(list, wanted, kind, true);
	return [...order.filter((c) => c.ready), ...order.filter((c) => !c.ready)];
}

async function streamIdOf(addon: Addon, what: What): Promise<string | null> {
	if (addon.ids === 'tmdb') return what.type === 'tv' ? `tmdb:${what.id}:${what.season}:${what.episode}` : `tmdb:${what.id}`;
	const ids = await tmdbGet<{ imdb_id?: string | null }>(`/${what.type === 'tv' ? 'tv' : 'movie'}/${what.id}/external_ids`);
	const imdb = ids?.imdb_id && /^tt\d+$/.test(ids.imdb_id) ? ids.imdb_id : null;
	if (!imdb) return null;
	return what.type === 'tv' ? `${imdb}:${what.season}:${what.episode}` : imdb;
}

/** The addon's streams for a film or episode (null: it couldn't be asked). */
export async function addonStreams(addon: Addon, what: What): Promise<AddonStream[] | null> {
	const id = await streamIdOf(addon, what);
	if (!id) return null;
	try {
		const response = await fetch(`${addon.base}/stream/${what.type === 'tv' ? 'series' : 'movie'}/${encodeURIComponent(id)}.json`, {
			headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
			// (Addons that gather from many others, like AIOStreams, can take a while.)
			signal: AbortSignal.timeout(30_000)
		});
		if (!response.ok) return null;
		const answer = (await response.json()) as { streams?: AddonStream[] };
		return Array.isArray(answer?.streams) ? answer.streams : [];
	} catch {
		return null;
	}
}

/* ------------------------------------------------ a copy's link */

type AddonAnswer = { url: string | null; why: string; name: string };
const known = new Map<string, AddonAnswer & { at: number }>();
const asking = new Map<string, Promise<AddonAnswer>>();

/**
 * What the player plays for an addon copy: a plain file's address, or the relay's for a playlist.
 * `why` says what went wrong when there's none; `name` is the stream played.
 */
export function addonStream(shareKey: string, fresh = false): Promise<AddonAnswer> {
	const what = parseAddonShareKey(shareKey);
	const addon = what && savedAddons().find((a) => a.key === what.key);
	if (!what || !addon) return Promise.resolve({ url: null, why: 'This addon was removed (Settings → Services)', name: '' });
	const kept = known.get(shareKey);
	if (kept && !fresh && Date.now() - kept.at < (kept.url ? 30 : 10) * MINUTE) return Promise.resolve(kept);
	const under = asking.get(shareKey);
	if (under) return under;
	const result = find(addon, what)
		.then((answer) => {
			if (answer.url || answer.why.startsWith('No ')) known.set(shareKey, { ...answer, at: Date.now() });
			return answer;
		})
		.finally(() => asking.delete(shareKey));
	asking.set(shareKey, result);
	return result;
}

const isPlaylist = (url: string) => /\.m3u8($|\?)/i.test(new URL(url).pathname + new URL(url).search);

async function find(addon: Addon, what: What & { quality: Wanted }): Promise<AddonAnswer> {
	const streams = await addonStreams(addon, what);
	if (streams === null) return { url: null, why: `${addon.name} couldn't be asked (or TMDB has no IMDb id for this)`, name: '' };
	const all = streams.map(candidateFrom).filter((c): c is Candidate => c !== null);
	const list = rankedCandidates(all, what.quality, what.type);
	const label = what.quality === '2160p' ? '4K' : '1080p';
	if (!list.length) return { url: null, why: `No ${label} stream from ${addon.name} with sound Catalog can play`, name: '' };

	// Web addresses first.
	for (const c of list.filter((c) => c.url)) {
		const url = c.url as string;
		const shown = c.filename || c.name;
		if (isPlaylist(url)) {
			trustAddonHost(url, c.headers);
			return { url: `/api/watch/relay?u=${encodeURIComponent(url)}`, why: '', name: shown };
		}
		// (A plain file the addon says needs its own headers can't be played as it is.)
		if (Object.keys(c.headers).length) continue;
		return { url, why: '', name: shown };
	}
	// Then torrents, through the debrid service.
	const torrents = list.filter((c) => !c.url && c.hash);
	if (!torrents.length) return { url: null, why: `No ${label} stream from ${addon.name} Catalog can play`, name: '' };
	const debrid = debridSetting();
	if (!debrid) return { url: null, why: `${addon.name} only has torrents for this: set up a debrid service in Settings → Services to play them`, name: '' };
	return readyLink(torrents, debrid.service, debrid.key);
}

/* ------------------------------------------------ lists (Browse rows) */

export type AddonShelf = { key: string; label: string; results: SearchResult[]; page: number };

/** A list's Browse row key: `addon~<addon key>~<movie|series>~<list id>`. */
const shelfKey = (addon: Addon, c: AddonCatalog) => `addon~${addon.key}~${c.type}~${c.id}`;

function parseShelfKey(key: string): { addon: Addon; catalog: AddonCatalog } | null {
	const m = key.match(/^addon~([a-f0-9]{8})~(movie|series)~(.+)$/);
	if (!m) return null;
	const addon = savedAddons().find((a) => a.key === m[1]);
	const catalog = addon?.catalogs?.find((c) => c.type === m[2] && c.id === m[3]);
	return addon && catalog ? { addon, catalog } : null;
}

export const isAddonShelf = (key: string) => key.startsWith('addon~');

type Meta = { id?: string; type?: string; name?: string };
const pageSizes = new Map<string, number>();
const listPages = new Map<string, { at: number; results: SearchResult[] }>();

async function catalogMetas(addon: Addon, catalog: AddonCatalog, skip: number): Promise<Meta[] | null> {
	const extra = skip > 0 ? `/skip=${skip}` : '';
	try {
		const response = await fetch(`${addon.base}/catalog/${catalog.type}/${encodeURIComponent(catalog.id)}${extra}.json`, {
			headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
			signal: AbortSignal.timeout(20_000)
		});
		if (!response.ok) return null;
		const answer = (await response.json()) as { metas?: Meta[] };
		return Array.isArray(answer?.metas) ? answer.metas : [];
	} catch {
		return null;
	}
}

const FIND_KEPT = 30 * 24 * 60 * MINUTE;

/** A list entry as a TMDB title (IMDb ids through TMDB's /find; kept), or null when TMDB doesn't know it. */
async function titleOf(meta: Meta, type: 'movie' | 'series'): Promise<SearchResult | null> {
	const id = String(meta.id ?? '');
	const kind = type === 'movie' ? 'movie' : 'tv';
	const cacheKey = `addon-title|${kind}|${id}`;
	const kept = getOrderCache(cacheKey);
	if (kept && Date.now() - kept.at < FIND_KEPT) return kept.value as SearchResult | null;

	let item: TmdbItem | null = null;
	const tmdb = id.match(/^tmdb:(\d+)/);
	if (/^tt\d+$/.test(id)) {
		const found = await tmdbGet<{ movie_results?: TmdbItem[]; tv_results?: TmdbItem[] }>(`/find/${id}`, { external_source: 'imdb_id' });
		if (!found) return null; // couldn't ask: not kept
		const own = kind === 'movie' ? found.movie_results?.[0] : found.tv_results?.[0];
		const other = kind === 'movie' ? found.tv_results?.[0] : found.movie_results?.[0];
		if (own) item = { ...own, media_type: kind };
		else if (other) item = { ...other, media_type: kind === 'movie' ? 'tv' : 'movie' };
	} else if (tmdb) {
		type Details = TmdbItem & { genres?: { id: number }[] };
		const details = await tmdbGet<Details>(`/${kind}/${tmdb[1]}`);
		if (!details) return null;
		item = { ...details, media_type: kind, genre_ids: details.genres?.map((g) => g.id) ?? [] };
	} else {
		return null; // (kitsu:, mal: and the like: not TMDB's)
	}
	const result = item ? toResult(item) : null;
	saveOrderCache(cacheKey, result, Date.now());
	return result;
}

/** Many at a time, but not all at once (TMDB allows about 50 a second). */
async function inTurns<T, R>(items: T[], work: (item: T) => Promise<R>, atOnce = 10): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(atOnce, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await work(items[i]);
			}
		})
	);
	return out;
}

/** One page of a list as TMDB titles (page 1 is the start; null: the addon couldn't be asked). Kept an hour. */
export async function addonListPage(key: string, page: number): Promise<SearchResult[] | null> {
	const found = parseShelfKey(key);
	if (!found) return [];
	const { addon, catalog } = found;
	if (page > 1 && !catalog.pages) return [];
	const cacheKey = `${key}|${page}`;
	const kept = listPages.get(cacheKey);
	if (kept && Date.now() - kept.at < 60 * MINUTE) return kept.results;

	// The addon says how many a page holds by its first page; "skip" counts from there.
	if (page > 1 && !pageSizes.has(key)) await addonListPage(key, 1);
	const skip = page > 1 ? (page - 1) * (pageSizes.get(key) ?? 100) : 0;
	const metas = await catalogMetas(addon, catalog, skip);
	if (metas === null) return null;
	if (page === 1 && metas.length) pageSizes.set(key, metas.length);
	const titles = await inTurns(metas.slice(0, 100), (m) => titleOf(m, catalog.type).catch(() => null));
	const seen = new Set<string>();
	const results = titles.filter((r): r is SearchResult => {
		if (!r || seen.has(r.key)) return false;
		seen.add(r.key);
		return true;
	});
	listPages.set(cacheKey, { at: Date.now(), results });
	return results;
}

/**
 * Every addon list as a Browse row (`only`: Browse's Films or TV tab shows just those lists).
 * A list slower than `wait` is left off this time; it carries on and is kept for the next.
 */
export async function addonShelves(only: '' | 'movies' | 'tv', wait = 8000): Promise<AddonShelf[]> {
	const lists = savedAddons().flatMap((addon) =>
		(addon.catalogs ?? [])
			.filter((c) => !only || (only === 'movies' ? c.type === 'movie' : c.type === 'series'))
			.map((catalog) => ({ addon, catalog }))
	);
	const rows = await Promise.all(
		lists.map(async ({ addon, catalog }) => {
			const key = shelfKey(addon, catalog);
			const asked = addonListPage(key, 1);
			asked.catch(() => {});
			const results = await Promise.race([asked, new Promise<null>((resolve) => setTimeout(() => resolve(null), wait).unref?.())]);
			return { key, label: `${catalog.name} · ${addon.name}`, results: results ?? [], page: 1 };
		})
	);
	return rows.filter((row) => row.results.length > 0);
}
