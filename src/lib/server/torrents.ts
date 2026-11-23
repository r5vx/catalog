/**
 * Torrents, for Nyaa's anime (sources/nyaa.ts): one file of a torrent downloaded while it plays.
 *
 * The player asks this server for the file (`/api/watch/torrent`) like any plain video, and the
 * bytes it asks for are fetched from other people's computers first (WebTorrent); the rest of the
 * file follows in order behind them. Like every torrent program, Catalog shares the pieces it has
 * with others while the file is open: that is what Settings → Services → Nyaa says before it's
 * turned on. Sharing is held to UPLOAD_LIMIT, nothing is shared once nobody has asked for the file
 * for IDLE_MS, the router's ports are never opened (UPnP/NAT-PMP off), and nothing is ever seeded
 * after that.
 *
 * Disk: %APPDATA%\Catalog\torrents\<info hash>, with the .torrent beside it, kept KEEP_MS after
 * last use (watching again later starts at once), within the downloads-ahead size in Settings →
 * Library, and never leaving under 5 GB free.
 *
 * WebTorrent is loaded the first time a torrent plays, not at start-up.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, statfsSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './db';
import { downloadsAheadLimitGb } from './episodeDownloads';
import { readInfo, SubtitleReader, type MkvInfo, playable } from './mkv';

/** Bytes a second shared with others, at most (the house's upload stays free for everything else). */
const UPLOAD_LIMIT = 150 * 1024;
const IDLE_MS = 10 * 60 * 1000;
const KEEP_MS = 2 * 24 * 60 * 60 * 1000;
const MIN_FREE = 5 * 1024 ** 3;

const root = () => join(dataDir, 'torrents');

/* eslint-disable @typescript-eslint/no-explicit-any */
type WT = any;
type WTTorrent = any;
type WTFile = any;

let clientPromise: Promise<WT> | null = null;
function client(): Promise<WT> {
	clientPromise ??= import('webtorrent').then(({ default: WebTorrent }) => {
		const c = new WebTorrent({ natUpnp: false, natPmp: false, lsd: false, uploadLimit: UPLOAD_LIMIT, maxConns: 40 });
		c.on('error', (e: Error) => console.warn('[torrents]', e.message));
		return c;
	});
	return clientPromise;
}

type Open = { torrent: WTTorrent; usedAt: number; info: Map<number, Promise<MkvInfo | null>>; subs: Map<number, SubtitleReader> };
const open = new Map<string, Open>();
const opening = new Map<string, Promise<Open>>();

const folderOf = (hash: string) => join(root(), hash.toLowerCase());

/** The .torrent kept for a hash, so it can be opened again after a restart without asking Nyaa. */
export function keptTorrentFile(hash: string): Buffer | null {
	try {
		return readFileSync(join(folderOf(hash), 'meta.torrent'));
	} catch {
		return null;
	}
}

/** Opens a torrent (from its .torrent file), with nothing chosen to download yet. */
export function openTorrent(hash: string, file: Buffer): Promise<Open> {
	hash = hash.toLowerCase();
	const known = open.get(hash);
	if (known) {
		known.usedAt = Date.now();
		return Promise.resolve(known);
	}
	let wait = opening.get(hash);
	if (!wait) {
		wait = (async () => {
			const c = await client();
			const dir = folderOf(hash);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, 'meta.torrent'), file);
			touch(hash);
			const torrent: WTTorrent = await new Promise((resolve, reject) => {
				const existing = c.torrents.find((t: WTTorrent) => t.infoHash === hash);
				if (existing) return resolve(existing);
				const t = c.add(file, { path: dir, deselect: true, strategy: 'sequential' });
				const timer = setTimeout(() => reject(new Error('torrent never got ready')), 60_000);
				t.once('ready', () => {
					clearTimeout(timer);
					resolve(t);
				});
				t.once('error', (e: Error) => {
					clearTimeout(timer);
					reject(e);
				});
			});
			const entry: Open = { torrent, usedAt: Date.now(), info: new Map(), subs: new Map() };
			open.set(hash, entry);
			return entry;
		})().finally(() => opening.delete(hash));
		opening.set(hash, wait);
	}
	return wait;
}

function touch(hash: string) {
	const at = new Date();
	try {
		utimesSync(join(folderOf(hash), 'meta.torrent'), at, at);
	} catch {}
}

function entryOf(hash: string): Open | null {
	const entry = open.get(hash.toLowerCase());
	if (entry) {
		entry.usedAt = Date.now();
		touch(hash);
	}
	return entry ?? null;
}

/** Stops a torrent at once (a release that won't play here); its .torrent stays for a while. */
export function closeTorrent(hash: string): void {
	const entry = open.get(hash.toLowerCase());
	if (!entry) return;
	open.delete(hash.toLowerCase());
	try {
		entry.torrent.destroy();
	} catch {}
}

/** Opens a torrent that was played before (its .torrent kept on disk), if it isn't open. */
export async function reopen(hash: string): Promise<Open | null> {
	const entry = entryOf(hash);
	if (entry) return entry;
	const file = keptTorrentFile(hash);
	if (!file) return null;
	try {
		return await openTorrent(hash, file);
	} catch {
		return null;
	}
}

/** The bytes of a file from `start` to `end` (not included), waiting for them to arrive. */
function reader(file: WTFile) {
	return async (start: number, end: number): Promise<Uint8Array> => {
		const parts: Uint8Array[] = [];
		if (end <= start) return new Uint8Array(0);
		for await (const chunk of file[Symbol.asyncIterator]({ start, end: end - 1 })) parts.push(chunk as Uint8Array);
		return parts.length === 1 ? parts[0] : new Uint8Array(Buffer.concat(parts));
	};
}

/** Whether a file's bytes from `start` to `end` are already on disk. */
function hasBytes(torrent: WTTorrent, file: WTFile) {
	return (start: number, end: number): boolean => {
		const length = torrent.pieceLength as number;
		const first = Math.floor((file.offset + start) / length);
		const last = Math.floor((file.offset + Math.max(start, end - 1)) / length);
		for (let i = first; i <= last; i++) if (!torrent.bitfield.get(i)) return false;
		return true;
	};
}

/** Whether 8 MB of a file after `at` is on disk already: the download is past that point. */
function pastBytes(torrent: WTTorrent, file: WTFile) {
	const has = hasBytes(torrent, file);
	return (at: number): boolean => at + 8 * 1024 * 1024 < file.length && has(at + 4 * 1024 * 1024, at + 8 * 1024 * 1024);
}

/** The tracks of a file in an open torrent (its start is fetched first). */
export function fileInfo(entry: Open, index: number): Promise<MkvInfo | null> {
	let info = entry.info.get(index);
	if (!info) {
		const file = entry.torrent.files[index];
		info = !file || !/\.mkv$/i.test(file.name)
			? Promise.resolve(null)
			: readInfo(reader(file), file.length).catch(() => null);
		entry.info.set(index, info);
	}
	return info;
}

/**
 * Starts a file downloading (the whole of it, in order) and says whether the player can play it.
 * An .mp4 is taken as playable; an .mkv is read for its tracks (10-bit H.264 and AC3/DTS-only
 * sound can't be played here).
 */
export async function startFile(hash: string, index: number, timeoutMs = 45_000): Promise<{ ok: boolean; why: string }> {
	const entry = await reopen(hash);
	if (!entry) return { ok: false, why: 'torrent not open' };
	const file = entry.torrent.files[index];
	if (!file) return { ok: false, why: 'no such file' };
	file.select();
	if (!/\.mkv$/i.test(file.name)) return { ok: true, why: '' };
	const info = await Promise.race([fileInfo(entry, index), new Promise<'slow'>((r) => setTimeout(() => r('slow'), timeoutMs))]);
	if (info === 'slow') return { ok: false, why: entry.torrent.numPeers ? 'too slow to start' : 'nobody is sharing it right now' };
	if (!info) return { ok: false, why: 'not a video file' };
	return playable(info);
}

/** Reading a file's own subtitle lines as it arrives (one reader per file). */
export async function subtitleReader(hash: string, index: number): Promise<{ info: MkvInfo; reader: SubtitleReader } | null> {
	const entry = await reopen(hash);
	if (!entry) return null;
	const file = entry.torrent.files[index];
	if (!file) return null;
	const info = await fileInfo(entry, index);
	if (!info) return null;
	let subs = entry.subs.get(index);
	if (!subs) {
		subs = new SubtitleReader(info, reader(file), hasBytes(entry.torrent, file), pastBytes(entry.torrent, file));
		entry.subs.set(index, subs);
	}
	// Reads on as far as it can; a piece still coming isn't waited for more than a few seconds here
	// (the reading carries on, and the player asks again).
	await Promise.race([subs.step(), new Promise((r) => setTimeout(r, 5000))]);
	return { info, reader: subs };
}

const typeOf = (name: string) =>
	/\.mp4$|\.m4v$/i.test(name) ? 'video/mp4' : /\.webm$/i.test(name) ? 'video/webm' : /\.mkv$/i.test(name) ? 'video/x-matroska' : 'application/octet-stream';

/** A file of a torrent, as an answer to the player's request (with Range, for seeking). */
export async function fileResponse(hash: string, index: number, range: string | null): Promise<Response> {
	const entry = await reopen(hash);
	const file = entry?.torrent.files[index];
	if (!entry || !file) return new Response('Not found', { status: 404 });
	file.select();
	const size = file.length as number;
	let start = 0;
	let end = size - 1;
	const m = range?.match(/bytes=(\d*)-(\d*)/);
	if (m) {
		if (m[1]) start = Number(m[1]);
		if (m[2]) end = Math.min(size - 1, Number(m[2]));
		if (!m[1] && m[2]) {
			start = Math.max(0, size - Number(m[2]));
			end = size - 1;
		}
		if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
	}
	const iterator: AsyncIterator<Uint8Array> = file[Symbol.asyncIterator]({ start, end });
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			entry.usedAt = Date.now();
			try {
				const { value, done } = await iterator.next();
				if (done) controller.close();
				else controller.enqueue(value);
			} catch (e) {
				controller.error(e);
			}
		},
		cancel() {
			iterator.return?.();
		}
	});
	const headers: Record<string, string> = {
		'Content-Type': typeOf(file.name),
		'Accept-Ranges': 'bytes',
		'Content-Length': String(end - start + 1),
		'Cache-Control': 'no-store'
	};
	if (m) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
	return new Response(body, { status: m ? 206 : 200, headers });
}

/** How the torrents playing are doing: for the player's details and /api/diagnostics. */
export function torrentStats() {
	return [...open.entries()].map(([hash, e]) => ({
		hash,
		name: e.torrent.name as string,
		peers: e.torrent.numPeers as number,
		downMbps: Math.round(((e.torrent.downloadSpeed as number) * 8) / 1e5) / 10,
		upKBps: Math.round((e.torrent.uploadSpeed as number) / 1024),
		downloadedMb: Math.round((e.torrent.downloaded as number) / 1e6),
		uploadedMb: Math.round((e.torrent.uploaded as number) / 1e6),
		idleS: Math.round((Date.now() - e.usedAt) / 1000)
	}));
}

/** Stops sharing torrents nobody has watched for a while, and clears old ones off the disk. */
export function tidyTorrents(): void {
	for (const [hash, e] of open) {
		if (Date.now() - e.usedAt < IDLE_MS) continue;
		open.delete(hash);
		try {
			e.torrent.destroy();
		} catch {}
	}
	if (!existsSync(root())) return;
	const folders = readdirSync(root())
		.map((name) => {
			const dir = join(root(), name);
			let at = 0;
			try {
				at = statSync(join(dir, 'meta.torrent')).mtimeMs;
			} catch {}
			return { name, dir, at, bytes: sizeOf(dir) };
		})
		.filter((f) => !open.has(f.name))
		.sort((a, b) => a.at - b.at);
	let total = folders.reduce((n, f) => n + f.bytes, 0);
	const limit = downloadsAheadLimitGb() * 1024 ** 3;
	let free = Infinity;
	try {
		const s = statfsSync(dataDir);
		free = s.bavail * s.bsize;
	} catch {}
	for (const f of folders) {
		const old = Date.now() - f.at > KEEP_MS;
		if (!old && total <= limit && free >= MIN_FREE) break;
		try {
			rmSync(f.dir, { recursive: true, force: true });
			total -= f.bytes;
			free += f.bytes;
		} catch {}
	}
}

function sizeOf(dir: string): number {
	let n = 0;
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, entry.name);
			n += entry.isDirectory() ? sizeOf(p) : statSync(p).size;
		}
	} catch {}
	return n;
}

setInterval(tidyTorrents, 60_000).unref?.();
