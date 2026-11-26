/**
 * Plex Free Movies & Shows (watch.plex.tv): free ad-supported VOD, no account required.
 *
 * Uses Plex's anonymous token endpoint (plex.tv/api/v2/users/anonymous) to search its catalog
 * (discover.provider.plex.tv) and check free VOD availability (vod.provider.plex.tv). Only plain,
 * non-DRM HLS copies are listed; DRM-only titles are skipped. Video plays through Catalog's relay
 * so phones and TVs play it too.
 */
import { randomUUID } from 'node:crypto';
import type { FileOption } from '../showbox';
import type { TmdbShow } from '../combinedEpisodes';
import { normalizeTitle, withoutQualifier } from '../metadata/types';
import { trustVideoHost } from '../relayHosts';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ANON_URL = 'https://plex.tv/api/v2/users/anonymous';
const DISCOVER_URL = 'https://discover.provider.plex.tv';
const VOD_URL = 'https://vod.provider.plex.tv';
const HOUR = 60 * 60 * 1000;

const clientId = randomUUID();
let session: { token: string; at: number } | null = null;
let sessionPending: Promise<string | null> | null = null;

function baseHeaders(token?: string): Record<string, string> {
	const h: Record<string, string> = {
		'User-Agent': UA,
		Accept: 'application/json',
		'X-Plex-Product': 'Plex Web',
		'X-Plex-Version': '4.145.1',
		'X-Plex-Client-Identifier': clientId,
		'X-Plex-Platform': 'Chrome'
	};
	if (token) h['X-Plex-Token'] = token;
	return h;
}

/** Headers for Plex's video servers, including the current anonymous token. */
export function plexHeaders(): Record<string, string> {
	return baseHeaders(session?.token);
}

async function getToken(fresh = false): Promise<string | null> {
	if (!fresh && session && Date.now() - session.at < 6 * HOUR) return session.token;
	if (sessionPending) return sessionPending;
	sessionPending = (async () => {
		try {
			const res = await fetch(ANON_URL, {
				method: 'POST',
				headers: baseHeaders(),
				signal: AbortSignal.timeout(10_000)
			});
			if (!res.ok) return null;
			const data = (await res.json()) as { authToken?: string };
			if (!data.authToken) return null;
			session = { token: data.authToken, at: Date.now() };
			return data.authToken;
		} catch {
			return null;
		} finally {
			sessionPending = null;
		}
	})();
	return sessionPending;
}

async function ask<T>(url: string, timeoutMs = 8000): Promise<T | null> {
	const token = await getToken();
	if (!token) return null;
	try {
		let res = await fetch(url, { headers: baseHeaders(token), signal: AbortSignal.timeout(timeoutMs) });
		if (res.status === 401) {
			const next = await getToken(true);
			if (!next) return null;
			res = await fetch(url, { headers: baseHeaders(next), signal: AbortSignal.timeout(timeoutMs) });
		}
		if (!res.ok) return null;
		return (await res.json()) as T;
	} catch {
		return null;
	}
}

/* ------------------------------------------------ types & helpers */

type PlexPart = { key?: string };
type PlexMedia = { protocol?: string; drm?: boolean; videoResolution?: string | number; Part?: PlexPart[] };
type PlexMeta = {
	ratingKey?: string;
	type?: string;
	title?: string;
	year?: number;
	index?: number;
	Media?: PlexMedia[];
};
type PlexContainer = {
	MediaContainer?: {
		Metadata?: PlexMeta[];
		SearchResults?: { SearchResult?: { Metadata?: PlexMeta }[] }[];
	};
};

const nameKey = (title: string) => normalizeTitle(withoutQualifier(title));

function qualityOf(media: PlexMedia): string {
	const raw = String(media.videoResolution ?? '').toLowerCase();
	if (raw === '4k' || raw === '2160') return '2160p';
	if (raw === '1080') return '1080p';
	if (raw === '720') return '720p';
	if (raw === '480' || raw === 'sd') return '480p';
	const n = Number(raw);
	return n >= 1000 ? '1080p' : n >= 700 ? '720p' : n > 0 ? `${n}p` : 'HD';
}

/** Pick the highest-resolution plain (non-DRM) HLS media entry. */
function clearHls(meta: PlexMeta | null | undefined): { key: string; quality: string } | null {
	const list = (meta?.Media ?? []).filter(
		(m) => m.protocol === 'hls' && !m.drm && m.Part?.[0]?.key
	);
	if (!list.length) return null;
	const score = (m: PlexMedia) => {
		const r = String(m.videoResolution ?? '').toLowerCase();
		if (r === '4k' || r === '2160') return 2160;
		return Number(r) || 0;
	};
	const best = list.sort((a, b) => score(b) - score(a))[0];
	return { key: best.Part![0].key!, quality: qualityOf(best) };
}

/* ------------------------------------------------ search & metadata */

const searchCache = new Map<string, { at: number; items: PlexMeta[] }>();
const vodCache = new Map<string, { at: number; meta: PlexMeta | null }>();

async function searchDiscover(query: string, type: 'movies' | 'tv'): Promise<PlexMeta[]> {
	const cacheKey = `${type}|${nameKey(query)}`;
	const hit = searchCache.get(cacheKey);
	if (hit && Date.now() - hit.at < 2 * HOUR) return hit.items;
	const params = new URLSearchParams({
		query,
		limit: '10',
		searchTypes: type,
		searchProviders: 'discover'
	});
	const data = await ask<PlexContainer>(`${DISCOVER_URL}/library/search?${params}`);
	const items: PlexMeta[] = [];
	for (const group of data?.MediaContainer?.SearchResults ?? []) {
		for (const sr of group.SearchResult ?? []) {
			if (sr.Metadata?.ratingKey) items.push(sr.Metadata);
		}
	}
	searchCache.set(cacheKey, { at: Date.now(), items });
	return items;
}

async function vodMeta(ratingKey: string, fresh = false): Promise<PlexMeta | null> {
	const hit = vodCache.get(ratingKey);
	if (!fresh && hit && Date.now() - hit.at < 6 * HOUR) return hit.meta;
	const data = await ask<PlexContainer>(`${VOD_URL}/library/metadata/${encodeURIComponent(ratingKey)}`);
	const meta = data?.MediaContainer?.Metadata?.[0] ?? null;
	vodCache.set(ratingKey, { at: Date.now(), meta });
	return meta;
}

/* ------------------------------------------------ share keys & exports */

export const plexShareKey = (ratingKey: string) => `plex:${ratingKey}`;

export function parsePlexShareKey(shareKey: string): string | null {
	return shareKey.match(/^plex:([a-zA-Z0-9_-]{8,40})$/)?.[1] ?? null;
}

function copy(ratingKey: string, quality: string): FileOption {
	return { fid: -31, quality, name: 'Plex', size: '', source: 'Plex', shareKey: plexShareKey(ratingKey) };
}

/** Plex's free copy of a film, matched by name and year, or none. */
export async function plexFilm(title: string, year: string, wait = 5000): Promise<FileOption[]> {
	const wantedName = nameKey(title);
	const wantedYear = Number(year) || 0;
	if (!wantedName) return [];
	const work = (async (): Promise<FileOption[]> => {
		const results = await searchDiscover(title, 'movies');
		const candidates = results.filter((m) => {
			if (m.type !== 'movie' || !m.ratingKey || !m.title) return false;
			if (nameKey(m.title) !== wantedName) return false;
			if (wantedYear && m.year && Math.abs(m.year - wantedYear) > 1) return false;
			return true;
		});
		for (const item of candidates.slice(0, 3)) {
			const vod = await vodMeta(item.ratingKey!);
			const hls = clearHls(vod);
			if (hls) return [copy(item.ratingKey!, hls.quality)];
		}
		return [];
	})().catch((err) => {
		console.warn('[plex] film lookup failed:', err);
		return [] as FileOption[];
	});
	return Promise.race([work, new Promise<FileOption[]>((r) => setTimeout(() => r([]), wait))]);
}

/** Plex's free copies of a show's episodes, by "season-episode". */
export async function plexFiles(show: TmdbShow, wait = 6000): Promise<Map<string, FileOption[]>> {
	const out = new Map<string, FileOption[]>();
	const wantedName = nameKey(show.name);
	if (!wantedName) return out;
	const started = Number(show.seasons.find((s) => s.number === 1)?.airDate?.slice(0, 4)) || 0;
	const work = (async () => {
		const results = await searchDiscover(show.name, 'tv');
		const match = results.find((m) => {
			if (m.type !== 'show' || !m.ratingKey || !m.title) return false;
			if (nameKey(m.title) !== wantedName) return false;
			if (started && m.year && Math.abs(m.year - started) > 1) return false;
			return true;
		});
		if (!match?.ratingKey) return;
		const seasonsData = await ask<PlexContainer>(`${VOD_URL}/library/metadata/${encodeURIComponent(match.ratingKey)}/children`);
		const seasons = seasonsData?.MediaContainer?.Metadata ?? [];
		if (!seasons.length) return;
		for (const season of seasons) {
			const sNum = season.index;
			if (!sNum || !season.ratingKey) continue;
			const tmdbSeason = show.seasons.find((s) => s.number === sNum);
			if (!tmdbSeason) continue;
			const epsData = await ask<PlexContainer>(`${VOD_URL}/library/metadata/${encodeURIComponent(season.ratingKey)}/children`);
			for (const ep of epsData?.MediaContainer?.Metadata ?? []) {
				const eNum = ep.index;
				if (!eNum || !ep.ratingKey || eNum < 1 || eNum > tmdbSeason.count) continue;
				const hls = clearHls(ep);
				if (!hls) continue;
				out.set(`${sNum}-${eNum}`, [copy(ep.ratingKey, hls.quality)]);
			}
		}
	})().catch((err) => console.warn('[plex] show lookup failed:', err));
	await Promise.race([work, new Promise((r) => setTimeout(r, wait))]);
	return new Map(out);
}

/** Whether Plex has a free, non-DRM copy of this title. */
export async function onPlex(title: string, type: string, year: string, show: () => Promise<TmdbShow | null>, pilot?: (listed: boolean) => void): Promise<boolean> {
	if (type === 'movie') return (await plexFilm(title, year, 8000)).length > 0;
	const found = await show();
	if (!found) return false;
	const files = await plexFiles(found, 8000);
	pilot?.(files.has('1-1'));
	return files.size > 0;
}

/** Resolve a Plex share key to a relayed HLS URL. */
export async function plexStream(shareKey: string, refresh = false): Promise<{ url: string; why: string }> {
	const id = parsePlexShareKey(shareKey);
	if (!id) return { url: '', why: 'Not a Plex copy' };
	const token = await getToken(refresh);
	if (!token) return { url: '', why: 'Plex did not give an anonymous session' };
	const vod = await vodMeta(id, refresh);
	if (!vod) return { url: '', why: 'Plex did not answer' };
	const hls = clearHls(vod);
	if (!hls) return { url: '', why: vod.Media?.length ? 'Plex only has a DRM-locked copy of this' : 'Plex no longer has this' };
	const fullUrl = hls.key.startsWith('http') ? hls.key : `${VOD_URL}${hls.key}`;
	trustVideoHost(fullUrl, 'plex');
	return { url: `/api/watch/relay?u=${encodeURIComponent(fullUrl)}`, why: '' };
}

/** Insert Plex copies right alongside Xumo Play (before slow unasked sources). */
export function withPlex(files: FileOption[], plex: FileOption[]): FileOption[] {
	if (!plex.length) return files;
	const at = files.findIndex((f) => f.source === 'Movy' || f.source === 'Vidfast');
	return at < 0 ? [...files, ...plex] : [...files.slice(0, at), ...plex, ...files.slice(at)];
}
