/*
 * YouTube for a Roku, the server's half (the computer's half is electron/youtubeHelper.cjs).
 *
 * - Search: YouTube's own search answers this computer directly (no sign-in, no bot check).
 * - Playing: the desktop app's hidden YouTube window plays the video and keeps every piece in
 *   <library folder>/youtube/<id>/ (index.json lists them); here they become an HLS stream: a main
 *   playlist, one for the picture and one for the sound (fMP4 pieces, their start parts as
 *   EXT-X-MAP). While pieces are still coming the playlists grow (EVENT); once all are kept they're
 *   VOD with an end. Only what's kept from the start without a gap is listed.
 * Desktop app only: anywhere else there's no hidden window.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './db';

export const youtubeDir = join(dataDir, 'youtube');
export const inDesktopApp = () => typeof process.send === 'function' && Boolean(process.env.CATALOG_DESKTOP);
export const isVideoId = (id: string) => /^[\w-]{6,20}$/.test(id);

type Piece = [start: number, duration: number, file: string, init: number];
type Track = { mime: string; inits: { file: string; height: number }[]; pieces: Piece[] };
export type YouTubeIndex = {
	id: string;
	duration: number;
	done: boolean;
	error: string | null;
	height: number;
	video: Track | null;
	audio: Track | null;
	log: string[];
};

export function readIndex(id: string): YouTubeIndex | null {
	const file = join(youtubeDir, id, 'index.json');
	if (!existsSync(file)) return null;
	try {
		return JSON.parse(readFileSync(file, 'utf8')) as YouTubeIndex;
	} catch {
		return null; // being written: asked again in a moment
	}
}

/** Asks the desktop app to keep `id` (and, already going, to make sure `from` seconds is kept). */
export function startCapture(id: string, from = 0) {
	process.send?.({ type: 'youtube-capture', id, dir: youtubeDir, from });
}

/** The pieces kept from the start with no gap, in order. */
function fromStart(track: Track): Piece[] {
	const list = [...track.pieces].sort((a, b) => a[0] - b[0]);
	const out: Piece[] = [];
	let end = 0;
	for (const p of list) {
		if (p[0] > end + 0.3) break;
		out.push(p);
		end = Math.max(end, p[0] + p[1]);
	}
	return out;
}

/** Seconds of both tracks kept from the start. */
export function keptSeconds(index: YouTubeIndex): number {
	const end = (t: Track | null) => {
		if (!t) return 0;
		const list = fromStart(t);
		const last = list[list.length - 1];
		return last ? last[0] + last[1] : 0;
	};
	return Math.min(end(index.video), end(index.audio));
}

const codecs = (mime: string) => mime.match(/codecs="?([^";]+)"?/)?.[1] ?? '';

export function mainPlaylist(index: YouTubeIndex): string {
	const video = index.video!;
	const audio = index.audio!;
	const height = index.height || Math.max(0, ...video.inits.map((i) => i.height));
	const width = Math.round((height * 16) / 9);
	return [
		'#EXTM3U',
		'#EXT-X-VERSION:7',
		'#EXT-X-INDEPENDENT-SEGMENTS',
		`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="sound",NAME="Sound",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"`,
		`#EXT-X-STREAM-INF:BANDWIDTH=${height >= 1080 ? 5_000_000 : height >= 720 ? 3_000_000 : 1_500_000},CODECS="${codecs(video.mime)},${codecs(audio.mime)}"${height ? `,RESOLUTION=${width}x${height}` : ''},AUDIO="sound"`,
		'video.m3u8',
		''
	].join('\n');
}

export function trackPlaylist(index: YouTubeIndex, kind: 'video' | 'audio'): string {
	const track = index[kind]!;
	const list = fromStart(track);
	const longest = Math.ceil(Math.max(1, ...list.map((p) => p[1])));
	const out = ['#EXTM3U', '#EXT-X-VERSION:7', `#EXT-X-TARGETDURATION:${longest}`, `#EXT-X-PLAYLIST-TYPE:${index.done ? 'VOD' : 'EVENT'}`, '#EXT-X-MEDIA-SEQUENCE:0'];
	let init = -1;
	for (const [, duration, file, pieceInit] of list) {
		if (pieceInit !== init) {
			if (init >= 0) out.push('#EXT-X-DISCONTINUITY');
			out.push(`#EXT-X-MAP:URI="${track.inits[pieceInit].file}"`);
			init = pieceInit;
		}
		out.push(`#EXTINF:${duration.toFixed(3)},`, file);
	}
	if (index.done) out.push('#EXT-X-ENDLIST');
	return out.join('\n') + '\n';
}

/* ------------------------------------------------------------ search */

export type YouTubeVideo = { id: string; title: string; channel: string; length: string; views: string; thumb: string };

const WEB = { clientName: 'WEB', clientVersion: '2.20251101.00.00', hl: 'en', gl: 'US' };

function walk(o: unknown, key: string, out: unknown[] = []): unknown[] {
	if (!o || typeof o !== 'object') return out;
	const rec = o as Record<string, unknown>;
	if (rec[key]) out.push(rec[key]);
	for (const k in rec) walk(rec[k], key, out);
	return out;
}

/** The largest picture YouTube lists for a video (720 wide, where its own pages use that). */
function biggestThumb(thumbnail: unknown): string | null {
	const list = (thumbnail as { thumbnails?: { url?: string; width?: number }[] } | undefined)?.thumbnails ?? [];
	let best: { url?: string; width?: number } | null = null;
	for (const t of list) if (t?.url && (t.width ?? 0) >= (best?.width ?? 0)) best = t;
	if (!best?.url) return null;
	return best.url.startsWith('//') ? 'https:' + best.url : best.url;
}

const textOf = (t: unknown): string => {
	const v = t as { simpleText?: string; runs?: { text: string }[] } | undefined;
	return v?.simpleText ?? v?.runs?.map((r) => r.text).join('') ?? '';
};

/** YouTube's own search, videos only (no live streams, no Shorts shelves). */
export async function searchYouTube(query: string): Promise<YouTubeVideo[]> {
	const resp = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' },
		body: JSON.stringify({ context: { client: WEB }, query, params: 'EgIQAQ%3D%3D' }),
		signal: AbortSignal.timeout(10_000)
	});
	if (!resp.ok) return [];
	const found = walk(await resp.json(), 'videoRenderer') as Record<string, unknown>[];
	const seen = new Set<string>();
	const out: YouTubeVideo[] = [];
	for (const v of found) {
		const id = String(v.videoId ?? '');
		const length = textOf(v.lengthText);
		if (!isVideoId(id) || seen.has(id) || !length) continue;
		seen.add(id);
		out.push({
			id,
			title: textOf(v.title),
			channel: textOf(v.ownerText),
			length,
			views: textOf(v.shortViewCountText),
			thumb: biggestThumb(v.thumbnail) ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
		});
	}
	return out;
}
