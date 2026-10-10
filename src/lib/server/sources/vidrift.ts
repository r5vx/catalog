/**
 * 7Movies (7movies.ac): a place to watch films and TV that Showbox may not have, or not yet.
 * Its player lives on embed.vidrift.net and is asked by TMDB id, season and episode — the same
 * numbers Catalog already uses — so nothing needs searching for or lining up.
 *
 * Its lookups answer plain requests (found with `npm run probe -- 7movies.ac`):
 *   - `/api/boot/<tv|movie>/<id>[/<season>/<episode>]` answers with the Orion server's playlist
 *     and a playback token. Orion is HEVC only (1080p/720p/480p), from a video server that lets
 *     any page play it, so its pieces go straight to the player.
 *   - `/api/source/<...>?token=…&hevc=0` answers with a server whose video is ordinary H.264
 *     (for TVs and computers that can't play HEVC), through vidrift's own relay.
 * vidrift only answers its own player (Referer and Origin), so its playlists — and the H.264
 * server's pieces — come through Catalog's relay (`/api/watch/relay`).
 */
import type { FileOption } from '../showbox';

const BASE = 'https://embed.vidrift.net';
const PLAYER = `${BASE}/embed2/play`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MINUTE = 60 * 1000;

/** What vidrift's servers expect to be asked with. */
export const VIDRIFT_HEADERS = { 'User-Agent': UA, Referer: PLAYER, Origin: BASE };

/** vidrift's own addresses: the relay fetches these with its player's headers. */
export function isVidriftVideo(url: URL): boolean {
	return url.protocol === 'https:' && (url.hostname === 'vidrift.net' || url.hostname.endsWith('.vidrift.net'));
}

/** Video servers that let any page play their pieces: left out of the relay, so they go straight to the player. */
export function playsDirect(url: URL): boolean {
	return url.protocol === 'https:' && url.hostname.endsWith('.hakunaymatata.com');
}

/** HEVC (Orion: sharper for its size, but not every TV can play it) or H.264 (plays anywhere). */
export type VidriftKind = 'hevc' | 'avc';
type What = { type: 'tv' | 'movie'; id: number; season: number; episode: number };

/** A 7Movies file's share key: `vidrift:<tv|movie>:<TMDB id>:<season>:<episode>:<hevc|avc>`. */
export function vidriftShareKey(what: What, kind: VidriftKind): string {
	return `vidrift:${what.type}:${what.id}:${what.season}:${what.episode}:${kind}`;
}

export function parseVidriftShareKey(shareKey: string): (What & { kind: VidriftKind }) | null {
	const m = shareKey.match(/^vidrift:(tv|movie):(\d+):(\d+):(\d+):(hevc|avc)$/);
	if (!m) return null;
	return { type: m[1] as 'tv' | 'movie', id: Number(m[2]), season: Number(m[3]), episode: Number(m[4]), kind: m[5] as VidriftKind };
}

/**
 * 7Movies' two copies of a film or episode (fids -4 and -3, like Aniwave's -1 and -2). The H.264
 * one comes first, so it's the one picked: it goes up to 1080p where Orion's HEVC often stops at
 * 720p (the owner's call, 2026-10-10).
 */
export function vidriftCopies(what: What): FileOption[] {
	return [
		{ fid: -4, quality: 'HD', name: '7Movies', size: '', source: '7Movies', shareKey: vidriftShareKey(what, 'avc') },
		{ fid: -3, quality: 'HD', name: '7Movies · Orion (HEVC)', size: '', source: '7Movies', hevc: true, shareKey: vidriftShareKey(what, 'hevc') }
	];
}

/* ------------------------------------------------ asking */

const path = (what: What) =>
	what.type === 'tv' ? `tv/${what.id}/${what.season}/${what.episode}` : `movie/${what.id}`;

async function ask<T>(url: string): Promise<T | null> {
	try {
		const response = await fetch(url, { headers: VIDRIFT_HEADERS, signal: AbortSignal.timeout(15000) });
		if (!response.ok) return null;
		return (await response.json()) as T;
	} catch {
		return null;
	}
}

type Boot = {
	meta?: {
		playbackToken?: string;
		unreleased?: unknown;
		orionStreams?: { url: string }[];
	};
};

const boots = new Map<string, { at: number; value: Boot | null }>();

/** The player's opening answer for one film or episode (kept 20 minutes). */
async function boot(what: What, fresh = false): Promise<Boot | null> {
	const key = path(what);
	const known = boots.get(key);
	if (known && !fresh && Date.now() - known.at < 20 * MINUTE) return known.value;
	const params = new URLSearchParams({ type: what.type, id: String(what.id), source: '0', provider: '', shell: '1' });
	if (what.type === 'tv') {
		params.set('season', String(what.season));
		params.set('episode', String(what.episode));
	}
	const value = await ask<Boot>(`${BASE}/api/boot/${key}?${params}`);
	boots.set(key, { at: Date.now(), value });
	return value;
}

/** True if the address answers with a playlist (an episode not out yet answers with nothing). */
async function isPlaylist(url: string): Promise<boolean> {
	try {
		const response = await fetch(url, { headers: VIDRIFT_HEADERS, signal: AbortSignal.timeout(15000) });
		if (!response.ok) return false;
		return (await response.text()).startsWith('#EXTM3U');
	} catch {
		return false;
	}
}

const streams = new Map<string, { at: number; url: string }>();

/**
 * The playlist address for a 7Movies copy, checked to answer. Null when 7Movies has nothing
 * for it right now. Kept 20 minutes (the video server's own links last days).
 */
export async function vidriftStream(shareKey: string, fresh = false): Promise<string | null> {
	const what = parseVidriftShareKey(shareKey);
	if (!what) return null;
	const known = streams.get(shareKey);
	if (known && !fresh && Date.now() - known.at < 20 * MINUTE) return known.url;

	const meta = (await boot(what, fresh))?.meta;
	if (!meta) return null;
	let url = '';
	if (what.kind === 'hevc') {
		const orion = meta.orionStreams?.[0]?.url;
		if (orion) url = new URL(orion, BASE).href;
	} else if (meta.playbackToken) {
		type Source = { success?: boolean; streams?: { url?: string; proxyUrl?: string }[] };
		const params = new URLSearchParams({ token: meta.playbackToken, provider: '', hevc: '0' });
		const answer = await ask<Source>(`${BASE}/api/source/${path(what)}?${params}`);
		const first = answer?.success ? answer.streams?.find((s) => s.proxyUrl || s.url) : undefined;
		if (first) url = new URL(first.proxyUrl || first.url!, BASE).href;
	}
	if (!url || !(await isPlaylist(url))) return null;
	streams.set(shareKey, { at: Date.now(), url });
	return url;
}

/** Whether 7Movies has a film or episode at all (for the Watch button's check). */
export async function onVidrift(what: Omit<What, 'season' | 'episode'> & { season?: number; episode?: number }): Promise<boolean> {
	const full = { season: 0, episode: 0, ...what };
	if (await vidriftStream(vidriftShareKey(full, 'hevc'))) return true;
	return Boolean(await vidriftStream(vidriftShareKey(full, 'avc')));
}
