/**
 * KickAssAnime (kaa.lt) — account-free anime streaming source with open JSON search,
 * episode listing, and direct HLS manifests (no Cloudflare challenge, relayed for TV & phone).
 */
import type { FileOption } from '../showbox';
import { trustVideoHost } from '../relayHosts';

const SITE = 'https://kaa.lt';
const PLAYER_ORIGIN = 'https://krussdomi.com';
const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const KAA_HEADERS: Record<string, string> = {
	'User-Agent': UA,
	Referer: `${PLAYER_ORIGIN}/`,
	Origin: PLAYER_ORIGIN
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export interface KaaShow {
	slug: string;
	name: string;
	en: string;
	type: string;
	start: string | null;
	locales: string[];
}

export interface KaaEpisode {
	number: number;
	slug: string;
}

const searchCache = new Map<string, { until: number; items: KaaShow[] }>();
const showCache = new Map<string, { until: number; item: KaaShow | null }>();
const epCache = new Map<string, { until: number; items: KaaEpisode[] }>();
const streamCache = new Map<string, { until: number; url: string }>();

async function kaaJson<T>(path: string, body?: unknown): Promise<T | null> {
	try {
		const headers: Record<string, string> = {
			'User-Agent': UA,
			Accept: 'application/json',
			Origin: SITE,
			Referer: `${SITE}/`
		};
		if (body !== undefined) headers['Content-Type'] = 'application/json';
		const resp = await fetch(`${SITE}${path}`, {
			method: body !== undefined ? 'POST' : 'GET',
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(10_000)
		});
		if (!resp.ok) return null;
		return (await resp.json()) as T;
	} catch {
		return null;
	}
}

export async function searchKaa(query: string): Promise<KaaShow[]> {
	const key = query.trim().toLowerCase();
	if (!key) return [];
	const hit = searchCache.get(key);
	if (hit && Date.now() < hit.until) return hit.items;
	type Row = {
		slug?: string;
		title?: string;
		title_en?: string;
		type?: string;
		year?: number;
		locales?: string[];
	};
	const rows = await kaaJson<Row[]>('/api/search', { query: query.trim() });
	const items: KaaShow[] = (Array.isArray(rows) ? rows : [])
		.filter((r) => r.slug && (r.title || r.title_en))
		.map((r) => ({
			slug: r.slug!,
			name: r.title || r.title_en || '',
			en: r.title_en || '',
			type: r.type || 'tv',
			start: r.year ? `${r.year}-01-01` : null,
			locales: Array.isArray(r.locales) ? r.locales : []
		}));
	searchCache.set(key, { until: Date.now() + 2 * HOUR, items });
	return items;
}

export async function kaaShowDetails(slug: string): Promise<KaaShow | null> {
	const hit = showCache.get(slug);
	if (hit && Date.now() < hit.until) return hit.item;
	type Detail = {
		slug?: string;
		title?: string;
		title_en?: string;
		type?: string;
		year?: number;
		start_date?: string;
		locales?: string[];
	};
	const d = await kaaJson<Detail>(`/api/show/${encodeURIComponent(slug)}`);
	const item: KaaShow | null = d?.slug
		? {
				slug: d.slug,
				name: d.title || d.title_en || '',
				en: d.title_en || '',
				type: d.type || 'tv',
				start: d.start_date?.slice(0, 10) || (d.year ? `${d.year}-01-01` : null),
				locales: Array.isArray(d.locales) ? d.locales : []
			}
		: null;
	showCache.set(slug, { until: Date.now() + 6 * HOUR, item });
	return item;
}

export async function kaaEpisodes(slug: string, lang: 'ja-JP' | 'en-US' = 'ja-JP'): Promise<KaaEpisode[]> {
	const key = `${slug}|${lang}`;
	const hit = epCache.get(key);
	if (hit && Date.now() < hit.until) return hit.items;
	type Page = {
		pages?: { number: number }[];
		result?: { slug?: string; episode_number?: number; episode_string?: string }[];
	};
	const first = await kaaJson<Page>(`/api/show/${encodeURIComponent(slug)}/episodes?ep=1&lang=${lang}`);
	if (!first?.result?.length) {
		epCache.set(key, { until: Date.now() + 30 * MINUTE, items: [] });
		return [];
	}
	const seen = new Map<number, KaaEpisode>();
	const add = (rows?: Page['result']) => {
		for (const r of rows ?? []) {
			const n = Number(r.episode_number ?? r.episode_string);
			if (Number.isInteger(n) && n > 0 && r.slug && !seen.has(n)) {
				seen.set(n, { number: n, slug: r.slug });
			}
		}
	};
	add(first.result);
	const pageNums = (first.pages ?? []).map((p) => p.number).filter((n) => n > 1).slice(0, 12);
	if (pageNums.length) {
		const rest = await Promise.all(
			pageNums.map((p) => kaaJson<Page>(`/api/show/${encodeURIComponent(slug)}/episodes?page=${p}&lang=${lang}`))
		);
		for (const page of rest) add(page?.result);
	}
	const items = [...seen.values()].sort((a, b) => a.number - b.number);
	epCache.set(key, { until: Date.now() + 6 * HOUR, items });
	return items;
}

export function kaaShareKey(slug: string, epNum: number, epSlug: string, kind: 'sub' | 'dub'): string {
	return `kaa:${slug}:${epNum}:${epSlug}:${kind}`;
}

export function parseKaaShareKey(
	shareKey: string
): { slug: string; epNum: number; epSlug: string; kind: 'sub' | 'dub' } | null {
	const m = shareKey.match(/^kaa:([^:]+):(\d+):([^:]+):(sub|dub)$/);
	if (!m) return null;
	return { slug: m[1], epNum: Number(m[2]), epSlug: m[3], kind: m[4] as 'sub' | 'dub' };
}

export function kaaCopies(
	slug: string,
	epNum: number,
	subSlug: string | null,
	dubSlug: string | null
): FileOption[] {
	const list: FileOption[] = [];
	if (subSlug) {
		list.push({
			fid: -33,
			quality: '1080p',
			name: `KickAssAnime · Japanese audio`,
			size: '',
			source: 'KickAssAnime',
			audio: 'Japanese',
			shareKey: kaaShareKey(slug, epNum, subSlug, 'sub')
		});
	}
	if (dubSlug) {
		list.push({
			fid: -34,
			quality: '1080p',
			name: `KickAssAnime · English dub`,
			size: '',
			source: 'KickAssAnime',
			audio: 'English',
			shareKey: kaaShareKey(slug, epNum, dubSlug, 'dub')
		});
	}
	return list;
}

export async function kaaStream(shareKey: string, fresh = false): Promise<{ url: string; why: string }> {
	const parsed = parseKaaShareKey(shareKey);
	if (!parsed) return { url: '', why: '' };
	const hit = streamCache.get(shareKey);
	if (hit && !fresh && Date.now() < hit.until) {
		trustVideoHost(hit.url, 'kaa');
		return { url: hit.url, why: '' };
	}
	type EpResp = { servers?: { name?: string; src?: string }[] };
	const ep = await kaaJson<EpResp>(
		`/api/show/${encodeURIComponent(parsed.slug)}/episode/ep-${parsed.epNum}-${encodeURIComponent(parsed.epSlug)}`
	);
	const servers = ep?.servers ?? [];
	for (const srv of servers) {
		if (!srv.src) continue;
		try {
			const resp = await fetch(srv.src, {
				headers: { 'User-Agent': UA, Referer: `${SITE}/` },
				signal: AbortSignal.timeout(10_000)
			});
			if (!resp.ok) continue;
			const html = await resp.text();
			const match = html.match(/https?:\/\/[^"'<>\s&]+\.m3u8(?:\?[^"'<>\s&]*)?/i);
			if (match) {
				const m3u8 = match[0];
				trustVideoHost(m3u8, 'kaa');
				streamCache.set(shareKey, { until: Date.now() + 30 * MINUTE, url: m3u8 });
				return { url: m3u8, why: '' };
			}
		} catch {}
	}
	return { url: '', why: "KickAssAnime couldn't load this episode right now" };
}
