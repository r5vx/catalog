/**
 * Pluto TV On Demand (pluto.tv): free ad-supported movies and TV shows, no account required.
 *
 * Uses Pluto's anonymous boot endpoint (boot.pluto.tv/v4/start) for a session token and stitcher
 * host, searches VOD titles (service-media-search.clusters.pluto.tv), and plays their HLS master
 * playlists through Catalog's relay so phones and TVs play them too.
 */
import { randomUUID } from 'node:crypto';
import type { FileOption } from '../showbox';
import type { TmdbShow } from '../combinedEpisodes';
import { normalizeTitle, withoutQualifier } from '../metadata/types';
import { trustVideoHost } from '../relayHosts';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BOOT_URL = 'https://boot.pluto.tv/v4/start';
const SEARCH_URL = 'https://service-media-search.clusters.pluto.tv/v1/search';
const VOD_URL = 'https://service-vod.clusters.pluto.tv/v4/vod';
const HOUR = 60 * 60 * 1000;

export function plutoHeaders(): Record<string, string> {
	return session?.token ? { 'User-Agent': UA, Authorization: `Bearer ${session.token}` } : { 'User-Agent': UA };
}

interface PlutoSession {
	token: string;
	stitcher: string;
	stitcherParams: string;
	at: number;
}

const clientId = randomUUID();
let session: PlutoSession | null = null;
let sessionPending: Promise<PlutoSession | null> | null = null;

async function getSession(fresh = false): Promise<PlutoSession | null> {
	if (!fresh && session && Date.now() - session.at < 30 * 60 * 1000) return session;
	if (sessionPending) return sessionPending;
	sessionPending = (async () => {
		try {
			const params = new URLSearchParams({
				appName: 'web',
				appVersion: '8.0.0-111b2b9dc00bd0bea9030b30662159ed9e7c8bc6',
				deviceVersion: '131.0.0',
				deviceModel: 'web',
				deviceMake: 'chrome',
				deviceType: 'web',
				clientID: clientId,
				clientModelNumber: '1.0.0',
				serverSideAds: 'false',
				drmCapabilities: 'widevine:L3',
				blockingMode: '',
				notificationVersion: '1',
				appMode: 'online',
				architecture: '',
				buildVersion: '',
				clientTime: new Date().toISOString()
			});
			const res = await fetch(`${BOOT_URL}?${params}`, {
				headers: { 'User-Agent': UA, Accept: 'application/json' },
				signal: AbortSignal.timeout(10_000)
			});
			if (!res.ok) return null;
			const data = (await res.json()) as {
				sessionToken?: string;
				servers?: { stitcher?: string };
				stitcherParams?: string;
			};
			if (!data.sessionToken) return null;
			session = {
				token: data.sessionToken,
				stitcher: data.servers?.stitcher || 'https://cfd-v4-service-channel-stitcher-use1-1.prd.pluto.tv',
				stitcherParams: data.stitcherParams || '',
				at: Date.now()
			};
			return session;
		} catch {
			return null;
		} finally {
			sessionPending = null;
		}
	})();
	return sessionPending;
}

async function ask<T>(url: string, timeoutMs = 8000): Promise<T | null> {
	const ses = await getSession();
	if (!ses) return null;
	try {
		let res = await fetch(url, {
			headers: { 'User-Agent': UA, Accept: 'application/json', Authorization: `Bearer ${ses.token}` },
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (res.status === 401) {
			const next = await getSession(true);
			if (!next) return null;
			res = await fetch(url, {
				headers: { 'User-Agent': UA, Accept: 'application/json', Authorization: `Bearer ${next.token}` },
				signal: AbortSignal.timeout(timeoutMs)
			});
		}
		if (!res.ok) return null;
		return (await res.json()) as T;
	} catch {
		return null;
	}
}

/* ------------------------------------------------ types & helpers */

type PlutoSearchItem = { id?: string; type?: string; name?: string };
type PlutoStitched = { paths?: { type?: string; path?: string }[] };
type PlutoItem = { _id?: string; name?: string; slug?: string; stitched?: PlutoStitched };
type PlutoEpisode = { _id?: string; season?: number; number?: number; name?: string; stitched?: PlutoStitched };
type PlutoSeriesSeasons = { name?: string; seasons?: { number?: number; episodes?: PlutoEpisode[] }[] };

const nameKey = (title: string) => normalizeTitle(withoutQualifier(title));

/** Extract a 4-digit year from a Pluto title like "Night of the Living Dead (1968)" or slug like "...-2013-1-1". */
function plutoYear(name?: string, slug?: string): number | null {
	const fromName = name?.match(/\((\d{4})\)\s*$/)?.[1];
	if (fromName) return Number(fromName);
	const fromSlug = slug?.match(/-((?:19|20)\d{2})(?:-\d+)*$/)?.[1];
	return fromSlug ? Number(fromSlug) : null;
}

function hlsPathOf(stitched?: PlutoStitched): string | null {
	return stitched?.paths?.find((p) => p.type === 'hls' && p.path)?.path ?? null;
}

const searchCache = new Map<string, { at: number; items: PlutoSearchItem[] }>();
const itemCache = new Map<string, { at: number; item: PlutoItem | null }>();

async function searchPluto(query: string): Promise<PlutoSearchItem[]> {
	const key = nameKey(query);
	const hit = searchCache.get(key);
	if (hit && Date.now() - hit.at < 2 * HOUR) return hit.items;
	const params = new URLSearchParams({ q: query, limit: '15' });
	const data = await ask<{ data?: PlutoSearchItem[] }>(`${SEARCH_URL}?${params}`);
	const items = data?.data ?? [];
	searchCache.set(key, { at: Date.now(), items });
	return items;
}

async function vodItem(id: string, fresh = false): Promise<PlutoItem | null> {
	const hit = itemCache.get(id);
	if (!fresh && hit && Date.now() - hit.at < 6 * HOUR) return hit.item;
	const data = await ask<PlutoItem[]>(`${VOD_URL}/items?ids=${encodeURIComponent(id)}`);
	const item = Array.isArray(data) ? (data[0] ?? null) : null;
	itemCache.set(id, { at: Date.now(), item });
	return item;
}

/* ------------------------------------------------ share keys & exports */

export const plutoShareKey = (id: string) => `pluto:${id}`;

export function parsePlutoShareKey(shareKey: string): string | null {
	return shareKey.match(/^pluto:([a-f0-9]{16,32})$/i)?.[1] ?? null;
}

function copy(id: string): FileOption {
	return { fid: -32, quality: 'HD', name: 'Pluto TV', size: '', source: 'Pluto TV', shareKey: plutoShareKey(id) };
}

/** Pluto TV's VOD copy of a film, strictly matched by normalized title and optional year. */
export async function plutoFilm(title: string, year: string, wait = 5000): Promise<FileOption[]> {
	const wantedName = nameKey(title);
	const wantedYear = Number(year) || 0;
	if (!wantedName) return [];
	const work = (async (): Promise<FileOption[]> => {
		const results = await searchPluto(title);
		const candidates = results.filter((r) => r.type === 'movie' && r.id && r.name && nameKey(r.name) === wantedName);
		for (const cand of candidates.slice(0, 3)) {
			const item = await vodItem(cand.id!);
			if (!item?._id) continue;
			const y = plutoYear(item.name, item.slug);
			if (wantedYear && y && Math.abs(y - wantedYear) > 1) continue;
			if (hlsPathOf(item.stitched)) return [copy(item._id)];
		}
		return [];
	})().catch((err) => {
		console.warn('[pluto] film lookup failed:', err);
		return [] as FileOption[];
	});
	return Promise.race([work, new Promise<FileOption[]>((r) => setTimeout(() => r([]), wait))]);
}

/** Pluto TV's VOD copies of a show's episodes, by "season-episode". */
export async function plutoFiles(show: TmdbShow, wait = 6000): Promise<Map<string, FileOption[]>> {
	const out = new Map<string, FileOption[]>();
	const wantedName = nameKey(show.name);
	if (!wantedName) return out;
	const work = (async () => {
		const results = await searchPluto(show.name);
		const match = results.find((r) => r.type === 'series' && r.id && r.name && nameKey(r.name) === wantedName);
		if (!match?.id) return;
		const data = await ask<PlutoSeriesSeasons>(`${VOD_URL}/series/${encodeURIComponent(match.id)}/seasons?offset=1000&page=1`);
		for (const season of data?.seasons ?? []) {
			const sNum = season.number;
			if (!sNum) continue;
			const tmdbSeason = show.seasons.find((s) => s.number === sNum);
			if (!tmdbSeason) continue;
			for (const ep of season.episodes ?? []) {
				const eNum = ep.number;
				if (!ep._id || !eNum || eNum < 1 || eNum > tmdbSeason.count) continue;
				out.set(`${sNum}-${eNum}`, [copy(ep._id)]);
			}
		}
	})().catch((err) => console.warn('[pluto] show lookup failed:', err));
	await Promise.race([work, new Promise((r) => setTimeout(r, wait))]);
	return new Map(out);
}

/** Whether Pluto TV has this title on demand. */
export async function onPluto(title: string, type: string, year: string, show: () => Promise<TmdbShow | null>, pilot?: (listed: boolean) => void): Promise<boolean> {
	if (type === 'movie') return (await plutoFilm(title, year, 8000)).length > 0;
	const found = await show();
	if (!found) return false;
	const files = await plutoFiles(found, 8000);
	pilot?.(files.has('1-1'));
	return files.size > 0;
}

/** Resolve a Pluto TV share key (movie or episode ID) to a relayed HLS URL. */
export async function plutoStream(shareKey: string, refresh = false): Promise<{ url: string; why: string }> {
	const id = parsePlutoShareKey(shareKey);
	if (!id) return { url: '', why: 'Not a Pluto TV copy' };
	const ses = await getSession(refresh);
	if (!ses) return { url: '', why: 'Pluto TV did not give a session' };
	const path = `/v2/stitch/hls/episode/${id}/master.m3u8`;
	const query = ses.stitcherParams ? `?${ses.stitcherParams}` : '';
	const fullUrl = `${ses.stitcher}${path}${query}`;
	trustVideoHost(fullUrl, 'pluto');
	return { url: `/api/watch/relay?u=${encodeURIComponent(fullUrl)}`, why: '' };
}

/** Insert Pluto TV copies right alongside Xumo Play and Plex. */
export function withPluto(files: FileOption[], pluto: FileOption[]): FileOption[] {
	if (!pluto.length) return files;
	const at = files.findIndex((f) => f.source === 'Movy' || f.source === 'Vidfast');
	return at < 0 ? [...files, ...pluto] : [...files.slice(0, at), ...pluto, ...files.slice(at)];
}

/* ----------------------------------------------------------- Live TV (Pluto TV) */

const CHANNELS_URL = 'https://service-channels.clusters.pluto.tv/v2/guide';

export interface PlutoLiveChannel {
	id: string;
	number: number;
	name: string;
	category: string;
	summary: string;
	logo: string | null;
	nowThumb: string | null;
	nowTitle: string;
	nowEpisode: string;
	nowStart: number;
	nowStop: number;
	nextTitle: string;
}

export interface PlutoLiveGuide {
	categories: string[];
	channels: PlutoLiveChannel[];
}

let liveGuideCache: { at: number; data: PlutoLiveGuide } | null = null;
let liveGuidePending: Promise<PlutoLiveGuide> | null = null;

/** All Pluto TV live channels with current "now playing" + "up next" EPG (cached 2 min). */
export async function plutoLiveGuide(): Promise<PlutoLiveGuide> {
	if (liveGuideCache && Date.now() - liveGuideCache.at < 2 * 60 * 1000) return liveGuideCache.data;
	if (liveGuidePending) return liveGuidePending;
	liveGuidePending = (async (): Promise<PlutoLiveGuide> => {
		const ses = await getSession();
		if (!ses) return { categories: [], channels: [] };
		const headers = { 'User-Agent': UA, Accept: 'application/json', Authorization: `Bearer ${ses.token}` };
		const [chRes, catRes] = await Promise.all([
			fetch(`${CHANNELS_URL}/channels?channelIds=&offset=0&limit=1000&sort=number:asc`, { headers, signal: AbortSignal.timeout(12_000) }).catch(() => null),
			fetch(`${CHANNELS_URL}/categories`, { headers, signal: AbortSignal.timeout(10_000) }).catch(() => null)
		]);
		if (!chRes?.ok) return { categories: [], channels: [] };
		const chJson = (await chRes.json()) as {
			data?: Array<{
				id?: string;
				number?: number;
				name?: string;
				summary?: string;
				categoryIDs?: string[];
				images?: Array<{ type?: string; url?: string }>;
			}>;
		};
		const catJson = catRes?.ok ? ((await catRes.json()) as { data?: Array<{ id?: string; name?: string }> }) : { data: [] };
		const catById = new Map<string, string>();
		const catOrder: string[] = [];
		for (const c of catJson.data ?? []) {
			if (c.id && c.name) {
				catById.set(c.id, c.name);
				catOrder.push(c.name);
			}
		}

		const rawChannels = (chJson.data ?? []).filter((c) => c.id && c.name);
		// Fetch EPG timelines in batches of 100 channels so we know what's airing right now.
		const nowIso = new Date().toISOString();
		type ImgRef = { path?: string };
		type TimelineEntry = {
			title?: string;
			start?: string;
			stop?: string;
			episode?: {
				name?: string;
				poster16_9?: ImgRef;
				featuredImage?: ImgRef;
				thumbnail?: ImgRef;
				poster?: ImgRef;
				series?: { poster16_9?: ImgRef; featuredImage?: ImgRef; tile?: ImgRef };
			};
		};
		const timelineMap = new Map<string, TimelineEntry[]>();
		const batches: string[][] = [];
		for (let i = 0; i < rawChannels.length; i += 100) {
			batches.push(rawChannels.slice(i, i + 100).map((c) => c.id!));
		}
		await Promise.all(
			batches.map(async (ids) => {
				try {
					const r = await fetch(
						`${CHANNELS_URL}/timelines?start=${encodeURIComponent(nowIso)}&channelIds=${ids.join(',')}&duration=180`,
						{ headers, signal: AbortSignal.timeout(10_000) }
					);
					if (!r.ok) return;
					const j = (await r.json()) as {
						data?: Array<{ channelId?: string; timelines?: TimelineEntry[] }>;
					};
					for (const item of j.data ?? []) {
						if (item.channelId && item.timelines) timelineMap.set(item.channelId, item.timelines);
					}
				} catch {}
			})
		);

		const nowMs = Date.now();
		const seenCats = new Set<string>();
		const channels: PlutoLiveChannel[] = [];
		for (const c of rawChannels) {
			const cat = (c.categoryIDs ?? []).map((id) => catById.get(id)).find(Boolean) ?? 'Other';
			seenCats.add(cat);
			const logo =
				c.images?.find((i) => i.type === 'colorLogoPNG')?.url ??
				c.images?.find((i) => i.type === 'solidLogoPNG')?.url ??
				c.images?.[0]?.url ??
				null;
			const tls = timelineMap.get(c.id!) ?? [];
			const currentIdx = tls.findIndex((t) => {
				const s = Date.parse(t.start ?? '');
				const e = Date.parse(t.stop ?? '');
				return Number.isFinite(s) && Number.isFinite(e) && s <= nowMs && e > nowMs;
			});
			const cur = currentIdx >= 0 ? tls[currentIdx] : tls[0];
			const next = currentIdx >= 0 ? tls[currentIdx + 1] : tls[1];
			const ep = cur?.episode;
			const nowThumb =
				ep?.poster16_9?.path ??
				ep?.featuredImage?.path ??
				ep?.thumbnail?.path ??
				ep?.series?.poster16_9?.path ??
				ep?.series?.featuredImage?.path ??
				ep?.series?.tile?.path ??
				ep?.poster?.path ??
				c.images?.find((i) => i.type === 'featuredImage')?.url ??
				null;
			channels.push({
				id: c.id!,
				number: c.number ?? 0,
				name: c.name!,
				category: cat,
				summary: c.summary ?? '',
				logo,
				nowThumb,
				nowTitle: cur?.title ?? '',
				nowEpisode: cur?.episode?.name && cur.episode.name !== cur.title ? cur.episode.name : '',
				nowStart: cur?.start ? Date.parse(cur.start) || 0 : 0,
				nowStop: cur?.stop ? Date.parse(cur.stop) || 0 : 0,
				nextTitle: next?.title ?? ''
			});
		}

		const categories = catOrder.filter((name) => seenCats.has(name));
		if (seenCats.has('Other') && !categories.includes('Other')) categories.push('Other');
		const data: PlutoLiveGuide = { categories, channels };
		liveGuideCache = { at: Date.now(), data };
		return data;
	})().finally(() => {
		liveGuidePending = null;
	});
	return liveGuidePending;
}

/** Live HLS master URL + auth headers for a Pluto TV live channel. */
export async function plutoLiveLink(channelId: string, refresh = false): Promise<{ url: string; headers: Record<string, string> } | null> {
	if (!/^[a-f0-9]{16,32}$/i.test(channelId)) return null;
	const ses = await getSession(refresh);
	if (!ses) return null;
	const query = ses.stitcherParams ? `?${ses.stitcherParams}` : '';
	const url = `${ses.stitcher}/v2/stitch/hls/channel/${channelId}/master.m3u8${query}`;
	return { url, headers: plutoHeaders() };
}
