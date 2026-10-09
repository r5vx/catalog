/**
 * Aniwave (aniwaves.ru): a second place to watch anime, for episodes Showbox doesn't have.
 *
 * Its lookups answer plain requests: search, a show's episode list, an episode's servers, then
 * a server's player, which hands over the video playlist. Only two versions are used, both
 * without subtitles burned into the picture:
 *   - "S-Sub" (ssub): Japanese audio, up to 1080p; Catalog shows its own subtitles over it.
 *   - "Dub": English audio.
 * Its plain "Sub" has the subtitles burned in, so it's never used.
 *
 * The video's servers only answer their own player (Referer https://play.echovideo.ru/) and
 * won't let another page read the video, so Catalog's server fetches it for the player and
 * passes it on (`/api/watch/relay`). That works the same on the desktop, a phone and the TV.
 */
import { getOrderCache, saveOrderCache } from '../db/queries';

const BASE = 'https://aniwaves.ru';
const PLAYER = 'https://play.echovideo.ru/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const HOUR = 60 * 60 * 1000;

export type AniwaveKind = 'ssub' | 'dub';

export interface AniwaveEntry {
	id: number;
	name: string;
	/** The Japanese name in letters ("Otome Kaijuu Caraméliser"). */
	jp: string;
	/** TV, ONA, OVA, Movie, Special… */
	type: string;
	/** When it started airing, YYYY-MM-DD. */
	start: string | null;
}

export interface AniwaveEpisode {
	number: number;
	sub: boolean;
	dub: boolean;
}

/** Video servers Aniwave has sent us to: the only ones the relay will fetch from. */
const videoHosts = new Set<string>();

export function isAniwaveVideo(url: URL): boolean {
	return url.protocol === 'https:' && videoHosts.has(url.host);
}

/** What Aniwave's video servers expect to be asked with. */
export const VIDEO_HEADERS = { 'User-Agent': UA, Referer: PLAYER, Origin: PLAYER.replace(/\/$/, '') };

export interface AniwaveStream {
	url: string;
	/** Subtitle files the player offers alongside (S-Sub only). */
	tracks: { label: string; file: string }[];
}

/* ------------------------------------------------ asking */

async function ask<T>(path: string, referer = `${BASE}/`): Promise<T | null> {
	try {
		const resp = await fetch(path.startsWith('http') ? path : `${BASE}${path}`, {
			headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Referer: referer },
			signal: AbortSignal.timeout(12000)
		});
		if (!resp.ok) return null;
		return (await resp.json()) as T;
	} catch {
		return null;
	}
}

function saved<T>(key: string, maxAge: number): T | undefined {
	const hit = getOrderCache(key);
	return hit && Date.now() - hit.at < maxAge ? (hit.value as T) : undefined;
}

const unescape = (s: string) =>
	s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&eacute;/g, 'é').replace(/&[a-z]+;/g, '');

/** "Jul 3, 2026 to Sep 18, 2026" → "2026-07-03". */
function startDate(text: string): string | null {
	const first = text.split(' to ')[0].trim();
	const time = Date.parse(`${first} UTC`);
	return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

/* ------------------------------------------------ finding a show */

export async function searchAniwave(query: string): Promise<AniwaveEntry[]> {
	const key = `aniwave-search|${query.toLowerCase()}`;
	const known = saved<AniwaveEntry[]>(key, 24 * HOUR);
	if (known) return known;

	const data = await ask<{ result?: { html?: string } }>(`/ajax/anime/search?keyword=${encodeURIComponent(query)}`);
	if (!data) return [];
	const html = data.result?.html ?? '';
	const entries: AniwaveEntry[] = [];
	for (const item of html.split('<a class="item"').slice(1)) {
		const id = Number(item.match(/href="\/watch\/[^"]*?-(\d+)"/)?.[1]);
		const name = item.match(/class="name d-title"[^>]*>([^<]*)</)?.[1];
		if (!id || !name) continue;
		const dots = [...item.matchAll(/<span class="dot">([^<]*)<\/span>/g)].map((m) => m[1].trim());
		entries.push({
			id,
			name: unescape(name),
			jp: unescape(item.match(/data-jp="([^"]*)"/)?.[1] ?? ''),
			type: dots[0] ?? '',
			start: dots[1] ? startDate(dots[1]) : null
		});
	}
	saveOrderCache(key, entries, Date.now());
	return entries;
}

/* ------------------------------------------------ episodes */

export async function aniwaveEpisodes(id: number): Promise<AniwaveEpisode[]> {
	const key = `aniwave-episodes|${id}`;
	const known = saved<AniwaveEpisode[]>(key, 3 * HOUR);
	if (known) return known;

	const data = await ask<{ result?: string }>(`/ajax/episode/list/${id}?vrf=`, `${BASE}/watch/${id}`);
	if (!data?.result) return [];
	const episodes: AniwaveEpisode[] = [];
	for (const m of data.result.matchAll(/<a [^>]*data-num="(\d+)"[^>]*>/g)) {
		const tag = m[0];
		if (/enabled="0"/.test(tag)) continue;
		episodes.push({
			number: Number(m[1]),
			sub: /data-sub="1"/.test(tag),
			dub: /data-dub="1"/.test(tag)
		});
	}
	saveOrderCache(key, episodes, Date.now());
	return episodes;
}

/* ------------------------------------------------ the video */

const streams = new Map<string, { stream: AniwaveStream; at: number }>();
const STREAM_TTL = 10 * 60 * 1000;

/**
 * The playlist for one episode in one version, trying each of Aniwave's servers for it in turn.
 * Null when none of them has it.
 */
export async function aniwaveStream(id: number, episode: number, kind: AniwaveKind, fresh = false): Promise<AniwaveStream | null> {
	const key = `${id}:${episode}:${kind}`;
	const hit = streams.get(key);
	if (hit && !fresh && Date.now() - hit.at < STREAM_TTL) return hit.stream;

	const page = `${BASE}/watch/${id}/ep-${episode}`;
	const list = await ask<{ result?: string }>(`/ajax/server/list?servers=${id}&eps=${episode}`, page);
	if (!list?.result) return null;
	const block = list.result.match(new RegExp(`data-type="${kind}"([\\s\\S]*?)</ul>`))?.[1] ?? '';
	const links = [...block.matchAll(/data-link-id="([^"]+)"/g)].map((m) => m[1]);

	for (const link of links) {
		const source = await ask<{ result?: { url?: string } }>(`/ajax/sources?id=${encodeURIComponent(link)}&asi=0&autoPlay=0`, page);
		const embed = source?.result?.url;
		if (!embed) continue;
		// The player's own lookup: …/embed-1/<id> → …/embed-1/getSources?id=<id>
		const bare = embed.split('?')[0];
		const answer = await ask<{ sources?: string; tracks?: { file?: string; label?: string; kind?: string }[] }>(
			bare.replace(/\/([^/]+)$/, '/getSources?id=$1'),
			embed
		);
		if (!answer?.sources || !/^https?:\/\//.test(answer.sources)) continue;
		const stream: AniwaveStream = {
			url: answer.sources,
			tracks: (answer.tracks ?? [])
				.filter((t) => t.file && t.kind !== 'thumbnails')
				.map((t) => ({ label: t.label ?? '', file: t.file! }))
		};
		videoHosts.add(new URL(stream.url).host);
		streams.set(key, { stream, at: Date.now() });
		return stream;
	}
	return null;
}

/** `aniwave:<id>:<episode>:<kind>` — what an Aniwave file plays from. */
export function aniwaveShareKey(id: number, episode: number, kind: AniwaveKind): string {
	return `aniwave:${id}:${episode}:${kind}`;
}

export function parseAniwaveShareKey(shareKey: string): { id: number; episode: number; kind: AniwaveKind } | null {
	const m = shareKey.match(/^aniwave:(\d+):(\d+):(ssub|dub)$/);
	return m ? { id: Number(m[1]), episode: Number(m[2]), kind: m[3] as AniwaveKind } : null;
}
