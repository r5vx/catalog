/**
 * How sharp each copy of a video really is: its picture's bit rate (Mbps), not the "1080p" its
 * source calls it. Diary of a Wimpy Kid: Dog Days (2026-11-08) said 1080p everywhere, but
 * Showbox's copy was a small YIFY rip at 2.2 Mbps, enlarged; 7Movies' "5 Mbps" was really 2.9;
 * Vidfast's was 7.3. The player's Files menu shows each copy's Mbps and marks the sharpest, and a
 * film whose Showbox copy is weak plays a clearly sharper one instead (WatchPlayer.svelte).
 *
 * Kept per copy (the same key as copy-audio: Showbox file number, or another source's share key)
 * in the library, for good: a copy's file doesn't change. Learned two ways: the player measures
 * the pieces it really loads (the most trusted), or this file loads two pieces of a copy nobody
 * has played (or, when its playlist gives each piece's size, reads them without loading any).
 */
import { getOrderCache, saveOrderCache } from './db/queries';
import { streamLink } from './streamLink';
import { ownFetch } from './ownFetch';

export type Sharpness = { mbps: number; height: number; from: 'played' | 'measured'; at: number };

const keyFor = (copy: string) => `copy-sharpness|${copy}`;
const FEBBOX_HEADERS = { Referer: 'https://www.febbox.com/', Origin: 'https://www.febbox.com' };

export function keptSharpness(keys: string[]): Record<string, Sharpness> {
	const out: Record<string, Sharpness> = {};
	for (const key of keys) {
		const kept = getOrderCache(keyFor(key))?.value as Sharpness | undefined;
		if (kept && Number(kept.mbps) > 0) out[key] = kept;
	}
	return out;
}

/** Saved, except that a measured guess never replaces what a player really saw. */
export function noteSharpness(key: string, mbps: number, height: number, from: Sharpness['from']): Sharpness | null {
	if (!key || !(mbps > 0.05 && mbps < 200)) return null;
	const before = keptSharpness([key])[key];
	if (before?.from === 'played' && from === 'measured') return before;
	const value: Sharpness = { mbps: Math.round(mbps * 10) / 10, height: Math.round(height) || 0, from, at: Date.now() };
	saveOrderCache(keyFor(key), value, value.at);
	return value;
}

/** One of a playlist's addresses: this server's relay ones through itself, the rest directly. */
async function get(url: string, timeout = 20_000): Promise<Response> {
	const signal = AbortSignal.timeout(timeout);
	if (url.startsWith('/')) return ownFetch(url, { signal });
	const host = new URL(url).host;
	const own = /(^|\.)(shegu\.net|febbox\.com)$/.test(host) ? FEBBOX_HEADERS : {};
	return fetch(url, { headers: own, signal });
}

function whole(address: string, base: string): string {
	if (/^https?:/i.test(address) || address.startsWith('/')) return address;
	return base.startsWith('/') ? new URL(address, `http://x${base}`).href.replace(/^http:\/\/x/, '') : new URL(address, base).href;
}

const attrs = (line: string) => {
	const found: Record<string, string> = {};
	for (const m of line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) found[m[1]] = m[2].replace(/^"|"$/g, '');
	return found;
};

type Piece = { url: string; seconds: number; bytes: number | null; range: string | null };

/**
 * The copy's picture bit rate, from its playlist: the level a 1080p screen would play (the
 * highest up to 1080p, else the highest there is), then two pieces of it a little way in.
 */
async function measureUrl(url: string): Promise<{ mbps: number; height: number } | null> {
	let base = url;
	let text = await (await get(base)).text();
	let height = 0;
	if (text.includes('#EXT-X-STREAM-INF')) {
		const lines = text.split('\n');
		const levels: { address: string; height: number; bandwidth: number }[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
			const a = attrs(lines[i]);
			const address = lines.slice(i + 1).find((l) => l.trim() && !l.startsWith('#'))?.trim();
			if (address) levels.push({ address, height: Number(a.RESOLUTION?.split('x')[1] ?? 0), bandwidth: Number(a.BANDWIDTH ?? 0) });
		}
		const upTo1080 = levels.filter((l) => l.height && l.height <= 1100);
		const pool = upTo1080.length ? upTo1080 : levels;
		const best = pool.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth)[0];
		if (!best) return null;
		height = best.height;
		base = whole(best.address, base);
		text = await (await get(base)).text();
	}
	const pieces: Piece[] = [];
	let seconds = 0;
	let range: string | null = null;
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (line.startsWith('#EXTINF:')) seconds = parseFloat(line.slice(8)) || 0;
		else if (line.startsWith('#EXT-X-BYTERANGE:')) range = line.slice(17);
		else if (line && !line.startsWith('#')) {
			const length = range ? Number(range.split('@')[0]) : null;
			pieces.push({ url: whole(line, base), seconds, bytes: length && length > 0 ? length : null, range });
			seconds = 0;
			range = null;
		}
	}
	const timed = pieces.filter((p) => p.seconds > 0);
	if (timed.length < 2) return null;
	// Byte ranges: every piece's size is in the playlist already.
	if (timed.every((p) => p.bytes)) {
		const bytes = timed.reduce((sum, p) => sum + (p.bytes ?? 0), 0);
		const time = timed.reduce((sum, p) => sum + p.seconds, 0);
		return { mbps: (bytes * 8) / time / 1e6, height };
	}
	// Otherwise two pieces, a fifth and a half of the way in (past any quiet opening titles).
	const picks = [timed[Math.floor(timed.length * 0.2)], timed[Math.floor(timed.length * 0.5)]].filter((p, i, all) => p && all.indexOf(p) === i);
	let bytes = 0;
	let time = 0;
	for (const piece of picks) {
		const resp = await get(piece.url, 45_000);
		if (!resp.ok) continue;
		bytes += (await resp.arrayBuffer()).byteLength;
		time += piece.seconds;
	}
	return time > 0 && bytes > 0 ? { mbps: (bytes * 8) / time / 1e6, height } : null;
}

/** Copies being measured right now (one ask per copy, however many screens ask). */
const measuring = new Map<string, Promise<Sharpness | null>>();

/** Measures a copy nobody has played yet, and keeps the answer. Null when it can't be had. */
export function measureCopy(key: string, shareKey: string, fid: number): Promise<Sharpness | null> {
	const kept = keptSharpness([key])[key];
	if (kept) return Promise.resolve(kept);
	const running = measuring.get(key);
	if (running) return running;
	const work = (async () => {
		try {
			const link = await streamLink(shareKey, fid);
			if (!link?.url) return null;
			const found = await measureUrl(link.url);
			return found ? noteSharpness(key, found.mbps, found.height, 'measured') : null;
		} catch {
			return null;
		}
	})().finally(() => measuring.delete(key));
	measuring.set(key, work);
	return work;
}
