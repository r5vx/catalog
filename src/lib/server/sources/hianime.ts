/**
 * HiAnime: another place for anime, alongside Aniwave: Japanese audio with English subtitles
 * (Catalog's own, not in the picture) and the English dub, up to 1080p.
 *
 * HiAnime's own player (zokoanime.video) is asked straight away by MyAnimeList number and
 * episode: the numbering AniSkip uses, worked out from TMDB's by the same chain
 * (`malEpisodeOf` in metadata/skiptimes.ts). So nothing is searched for and seasons don't need
 * lining up by name.
 *
 * The player's page carries its setup in `window.__P`: base64 of JSON, XORed with
 * "otaku-embed-v1" (how ani-cli reads it; found in Streambert, 2026-11-04). In it: the master
 * playlist and the subtitle files. The video servers (hls.dramahot.top on 2026-11-04) only
 * answer their player (Referer https://zokoanime.video/), so the relay fetches them, as for
 * Aniwave. Measured: Frieren E1 sub and dub, 360p/720p/1080p, about 3 s from asking.
 */
import { getOrderCache, saveOrderCache } from '../db/queries';
import { trustVideoHost } from '../relayHosts';
import type { FileOption } from '../showbox';

const PLAYER = 'https://zokoanime.video';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const KEY = Buffer.from('otaku-embed-v1');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** What HiAnime's video servers expect to be asked with. */
export const HIANIME_HEADERS = { 'User-Agent': UA, Referer: `${PLAYER}/`, Origin: PLAYER };

export type HianimeKind = 'sub' | 'dub';

export const hianimeShareKey = (mal: number, episode: number, kind: HianimeKind) => `hianime:${mal}:${episode}:${kind}`;

export function parseHianimeShareKey(shareKey: string): { mal: number; episode: number; kind: HianimeKind } | null {
	const m = /^hianime:(\d+):(\d+):(sub|dub)$/.exec(shareKey);
	return m ? { mal: Number(m[1]), episode: Number(m[2]), kind: m[3] as HianimeKind } : null;
}

export interface HianimeStream {
	url: string;
	/** Subtitle files the player offers (English, sometimes more). */
	tracks: { label: string; file: string }[];
}

/** The first playlist address anywhere in the setup. */
function findPlaylist(value: unknown): string | null {
	if (typeof value === 'string') return /\.m3u8/i.test(value) ? value : null;
	if (Array.isArray(value)) {
		for (const v of value) {
			const found = findPlaylist(v);
			if (found) return found;
		}
	} else if (value && typeof value === 'object') {
		for (const v of Object.values(value)) {
			const found = findPlaylist(v);
			if (found) return found;
		}
	}
	return null;
}

async function ask(mal: number, episode: number, kind: HianimeKind): Promise<HianimeStream | null> {
	const page = await fetch(`${PLAYER}/stream/mal/${mal}/${episode}/${kind}`, {
		headers: { 'User-Agent': UA, Accept: 'text/html' },
		signal: AbortSignal.timeout(15_000)
	});
	if (!page.ok) return null;
	const blob = /window\.__P="([^"]*)"/.exec(await page.text())?.[1];
	if (!blob) return null;
	const bytes = Buffer.from(blob, 'base64');
	for (let i = 0; i < bytes.length; i++) bytes[i] ^= KEY[i % KEY.length];
	let setup: { subtitles?: { src?: string; label?: string; lang?: string }[] } & Record<string, unknown>;
	try {
		setup = JSON.parse(bytes.toString('utf8'));
	} catch {
		return null;
	}
	const url = findPlaylist(setup)?.replace(/\\\//g, '/');
	if (!url || !/^https:\/\//.test(url)) return null;
	trustVideoHost(url, 'hianime');
	const tracks = (Array.isArray(setup.subtitles) ? setup.subtitles : [])
		.filter((s) => typeof s?.src === 'string' && /^https:\/\//.test(s.src))
		.map((s) => {
			trustVideoHost(s.src!, 'hianime');
			return { label: String(s.label || s.lang || 'English'), file: s.src! };
		});
	return { url, tracks };
}

/** Links are kept 15 minutes (as other sources'); asked once at a time per episode and version. */
const known = new Map<string, { at: number; result: Promise<HianimeStream | null> }>();

export function hianimeStream(mal: number, episode: number, kind: HianimeKind, fresh = false): Promise<HianimeStream | null> {
	const key = hianimeShareKey(mal, episode, kind);
	const hit = known.get(key);
	if (hit && !fresh && Date.now() - hit.at < 15 * MINUTE) return hit.result;
	const result = ask(mal, episode, kind).catch(() => null);
	known.set(key, { at: Date.now(), result });
	result.then((r) => {
		if (!r) known.delete(key);
	});
	return result;
}

/** Started ahead of time (the next episode, a hovered Watch button). */
export function warmHianimeStream(mal: number, episode: number, kind: HianimeKind): void {
	void hianimeStream(mal, episode, kind);
}

/**
 * Whether HiAnime has this MyAnimeList entry (and its dub), by asking for its first episode.
 * Kept 12 hours in the library, so an episode list asks once per season and version.
 */
export async function hianimeHas(mal: number, kind: HianimeKind): Promise<boolean> {
	const key = `hianime-has|${mal}|${kind}`;
	const kept = getOrderCache(key);
	if (kept && Date.now() - kept.at < 12 * HOUR) return kept.value === true;
	const stream = await hianimeStream(mal, 1, kind);
	// A refusal of the whole site (it didn't answer) isn't kept: asked again next time.
	if (stream || (await siteAnswers())) saveOrderCache(key, Boolean(stream), Date.now());
	return Boolean(stream);
}

async function siteAnswers(): Promise<boolean> {
	try {
		const r = await fetch(`${PLAYER}/`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
		return r.status < 500;
	} catch {
		return false;
	}
}

/** One episode's copies on HiAnime: Japanese audio (subtitles are Catalog's own) and the dub, as it has them. */
export function hianimeCopies(mal: number, episode: number, has: { sub: boolean; dub: boolean }): FileOption[] {
	const list: FileOption[] = [];
	if (has.sub) {
		list.push({ fid: -6, quality: '1080p', name: 'HiAnime · Japanese audio', size: '', source: 'HiAnime', audio: 'Japanese', shareKey: hianimeShareKey(mal, episode, 'sub') });
	}
	if (has.dub) {
		list.push({ fid: -7, quality: '1080p', name: 'HiAnime · English dub', size: '', source: 'HiAnime', audio: 'English', shareKey: hianimeShareKey(mal, episode, 'dub') });
	}
	return list;
}
