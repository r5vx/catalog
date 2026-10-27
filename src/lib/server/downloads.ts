/**
 * Downloads: a film, an episode or a replay kept on this computer, to watch with no internet, or
 * to save onto a phone (an iPhone's Files app plays it) for somewhere with no Wi-Fi.
 *
 * The player says what to download: a copy from another source than Showbox (its share key and
 * file number), or a replay and its version; the quality (720p and up as offered); the sound
 * track; and the subtitles showing (already timed to the video). Showbox's copies never are:
 * they'd use up Febbox's daily allowance (the API refuses them). The computer then:
 *   1. asks for the copy's playlist as the player would (streamLink.ts, replays' own answer);
 *   2. downloads the pieces of the quality picked and of its sound track, four at a time, into
 *      downloads/<id>/ — asking for a fresh link when one runs out (Showbox's last a few hours);
 *   3. makes them into one ordinary MP4 (mp4Flatten.ts; TS pieces through mux.js first) and
 *      deletes the pieces.
 * One download at a time, in the order asked; one left unfinished carries on when Catalog
 * starts again, from the pieces it has.
 */
import { createDecipheriv } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, statfsSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error mux.js has no types of its own.
import muxjs from 'mux.js';
import { dataDir } from './db';
import { addDownload, deleteDownloadRow, findDownload, getDownload, listDownloads, updateDownload, type DownloadRow } from './db/queries';
import { streamLink } from './streamLink';
import { replayAnswer } from './replayAnswer';
import { ownFetch } from './ownFetch';
import { flattenToMp4, type Series } from './mp4Flatten';

export const DOWNLOADS_DIR = join(dataDir, 'downloads');
const AT_ONCE = 4;
/** Never fill the disk past this much free. */
const MIN_FREE = 5 * 1024 ** 3;
/** Febbox's video servers only answer its own player. */
const FEBBOX_HEADERS = { Referer: 'https://www.febbox.com/', Origin: 'https://www.febbox.com' };

export type DownloadAsk = {
	kind: DownloadRow['kind'];
	title: string;
	year: string;
	season: number;
	episode: number;
	episodeName: string | null;
	poster: string | null;
	source: string;
	shareKey: string | null;
	fid: number | null;
	replayId: string | null;
	replayVersion: number | null;
	/** The picture's height wanted (0: the best there is). */
	height: number;
	/** The sound track: its language and name, "ja|Japanese" ('' for the default). */
	audio: string;
	/** The subtitles showing, as SRT, timed to the video. */
	subtitles: string | null;
	/** Its size, as the player worked it out (bytes; 0 if not known). */
	estimate: number;
};

export const folderOf = (id: number) => join(DOWNLOADS_DIR, String(id));
export const fileOf = (id: number) => join(folderOf(id), 'video.mp4');
export const subtitlesOf = (id: number) => join(folderOf(id), 'subtitles.srt');

/** Starts a download (or answers the one already there for the same thing). */
export function startDownload(ask: DownloadAsk): { id: number; already: boolean } {
	const known = findDownload(ask.kind, ask.title, ask.season, ask.episode, ask.replayId);
	if (known) return { id: known.id, already: true };
	const id = addDownload({ ...ask, hasSubtitles: Boolean(ask.subtitles) });
	mkdirSync(folderOf(id), { recursive: true });
	if (ask.subtitles) writeFileSync(subtitlesOf(id), ask.subtitles);
	queue();
	return { id, already: false };
}

/** A download stopped (if under way) and deleted with its file. */
export function removeDownload(id: number): void {
	if (running?.id === id) running.stop.abort();
	deleteDownloadRow(id);
	rmSync(folderOf(id), { recursive: true, force: true });
}

/** A failed download tried again, from the pieces it has. */
export function retryDownload(id: number): void {
	updateDownload(id, { state: 'waiting', error: null });
	queue();
}

/** How far each download under way has got, for the list (live, between saves). */
export function downloadProgress(): Map<number, { done: number; total: number; bytes: number; speed: number }> {
	return new Map(running ? [[running.id, { ...running.progress }]] : []);
}

/** Space left on the disk downloads go to. */
export function freeSpace(): number | null {
	try {
		mkdirSync(DOWNLOADS_DIR, { recursive: true });
		const fs = statfsSync(DOWNLOADS_DIR);
		return fs.bavail * fs.bsize;
	} catch {
		return null;
	}
}

/**
 * Unfinished downloads carry on a little after Catalog starts. (Marked waiting straight away:
 * done 30 s later, it also marked one started meanwhile, which then said "Waiting" as it went.)
 */
export function resumeDownloads(): void {
	for (const d of listDownloads()) if (d.state === 'downloading' || d.state === 'finishing') updateDownload(d.id, { state: 'waiting' });
	setTimeout(queue, 30_000);
}

/* ------------------------------------------------------------------ the queue */

let running: { id: number; stop: AbortController; progress: { done: number; total: number; bytes: number; speed: number } } | null = null;

function queue(): void {
	if (running) return;
	const next = listDownloads()
		.filter((d) => d.state === 'waiting')
		.sort((a, b) => a.id - b.id)[0];
	if (!next) return;
	running = { id: next.id, stop: new AbortController(), progress: { done: next.donePieces, total: next.totalPieces, bytes: next.bytes, speed: 0 } };
	const stop = running.stop.signal;
	download(next, stop)
		.catch((e) => {
			if (stop.aborted) return;
			updateDownload(next.id, { state: 'failed', error: String((e as Error)?.message ?? e) });
		})
		.finally(() => {
			running = null;
			queue();
		});
}

/* ------------------------------------------------------------------ playlists */

type Piece = { url: string; range?: [number, number]; key?: Key; sequence: number };
type Key = { url: string; iv: Uint8Array | null };
type Track = { init: Piece | null; pieces: Piece[] };
type Plan = { plain: string | null; video: Track | null; audio: Track | null; duration: number };

/** Fetches one of the addresses a playlist names: relay ones of this server, Showbox's directly. */
async function get(url: string, signal: AbortSignal, range?: [number, number]): Promise<Response> {
	const headers: Record<string, string> = range ? { Range: `bytes=${range[0]}-${range[0] + range[1] - 1}` } : {};
	const timeout = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
	if (url.startsWith('/')) return ownFetch(url, { headers, signal: timeout });
	const host = new URL(url).host;
	const own = /(^|\.)(shegu\.net|febbox\.com)$/.test(host) ? FEBBOX_HEADERS : {};
	return fetch(url, { headers: { ...own, ...headers }, signal: timeout });
}

const attrs = (line: string) => {
	const found: Record<string, string> = {};
	for (const m of line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) found[m[1]] = m[2].replace(/^"|"$/g, '');
	return found;
};
/** An address in a playlist, made whole against the playlist's own (relay addresses stay relative to this server). */
function whole(address: string, base: string): string {
	if (/^https?:/i.test(address) || address.startsWith('/')) return address;
	return base.startsWith('/') ? new URL(address, `http://x${base}`).href.replace(/^http:\/\/x/, '') : new URL(address, base).href;
}

function mediaPlaylist(text: string, base: string): Track & { duration: number } {
	const track: Track & { duration: number } = { init: null, pieces: [], duration: 0 };
	let sequence = 0;
	let key: Key | undefined;
	let range: [number, number] | undefined;
	let lastEnd = 0;
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) sequence = Number(line.split(':')[1]) || 0;
		else if (line.startsWith('#EXT-X-MAP:')) {
			const a = attrs(line);
			const r = a.BYTERANGE?.split('@').map(Number);
			track.init = { url: whole(a.URI, base), range: r ? [r[1] ?? 0, r[0]] : undefined, sequence: -1 };
		} else if (line.startsWith('#EXT-X-KEY:')) {
			const a = attrs(line);
			key = a.METHOD === 'AES-128' ? { url: whole(a.URI, base), iv: a.IV ? Buffer.from(a.IV.replace(/^0x/i, '').padStart(32, '0'), 'hex') : null } : undefined;
			if (a.METHOD && a.METHOD !== 'NONE' && a.METHOD !== 'AES-128') throw new Error(`Can't download this kind of locked video (${a.METHOD})`);
		} else if (line.startsWith('#EXT-X-BYTERANGE:')) {
			const [length, offset] = line.split(':')[1].split('@').map(Number);
			range = [Number.isFinite(offset) ? offset : lastEnd, length];
			lastEnd = range[0] + length;
		} else if (line.startsWith('#EXTINF:')) track.duration += parseFloat(line.slice(8)) || 0;
		else if (!line.startsWith('#')) {
			track.pieces.push({ url: whole(line, base), range, key, sequence: sequence++ });
			range = undefined;
		}
	}
	return track;
}

/** A playlist's text, or null (and the rest left unread) when it's a video file instead. */
async function playlistText(resp: Response): Promise<string | null> {
	const reader = resp.body!.getReader();
	const chunks: Uint8Array[] = [];
	const first = await reader.read();
	if (first.value) chunks.push(first.value);
	if (!new TextDecoder().decode(first.value?.subarray(0, 32)).trimStart().startsWith('#EXTM3U')) {
		reader.cancel().catch(() => {});
		return null;
	}
	for (let next = await reader.read(); !next.done; next = await reader.read()) chunks.push(next.value);
	return new TextDecoder().decode(Buffer.concat(chunks));
}

/** The pieces to download, for the quality and sound track asked. */
async function planFor(row: DownloadRow, signal: AbortSignal, fresh: boolean): Promise<Plan> {
	let address = '';
	if (row.kind === 'replay') {
		const answer = await replayAnswer(row.replayId ?? '', row.replayVersion);
		address = answer?.url ?? '';
	} else address = (await streamLink(row.shareKey ?? '', Number(row.fid), fresh)).url;
	if (!address) throw new Error("The video can't be found right now");

	const first = await get(address, signal);
	if (!first.ok) throw new Error(`The video's server answered ${first.status}`);
	// A playlist, or one plain video file (some replays): told by how it starts.
	const text = await playlistText(first);
	if (text === null) return { plain: address, video: null, audio: null, duration: 0 };
	if (!text.includes('#EXT-X-STREAM-INF')) {
		const media = mediaPlaylist(text, address);
		return { plain: null, video: media, audio: null, duration: media.duration };
	}

	// A choice of qualities: the one asked (H.264 before HEVC at the same height), or the best below it.
	const lines = text.split('\n').map((l) => l.trim());
	const variants: { url: string; height: number; avc: boolean; audio: string; bandwidth: number }[] = [];
	const audios: { group: string; url: string; lang: string; name: string; isDefault: boolean }[] = [];
	lines.forEach((line, i) => {
		if (line.startsWith('#EXT-X-STREAM-INF:')) {
			const a = attrs(line);
			const url = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
			if (!url) return;
			variants.push({
				url: whole(url, address),
				height: Number(a.RESOLUTION?.split('x')[1] ?? 0),
				avc: !/hvc1|hev1/i.test(a.CODECS ?? ''),
				audio: a.AUDIO ?? '',
				bandwidth: Number(a.BANDWIDTH ?? 0)
			});
		} else if (line.startsWith('#EXT-X-MEDIA:') && /TYPE=AUDIO/.test(line)) {
			const a = attrs(line);
			if (a.URI) audios.push({ group: a['GROUP-ID'] ?? '', url: whole(a.URI, address), lang: a.LANGUAGE ?? '', name: a.NAME ?? '', isDefault: a.DEFAULT === 'YES' });
		}
	});
	if (!variants.length) throw new Error('No video in its playlist');
	const wanted = row.height || Infinity;
	const fits = variants.filter((v) => v.height <= wanted);
	const pool = fits.length ? fits : variants;
	const best = Math.max(...pool.map((v) => v.height));
	const variant = pool.filter((v) => v.height === best).sort((a, b) => Number(b.avc) - Number(a.avc) || b.bandwidth - a.bandwidth)[0];

	const videoText = await (await get(variant.url, signal)).text();
	const video = mediaPlaylist(videoText, variant.url);
	let audio: Track | null = null;
	const group = audios.filter((a) => a.group === variant.audio);
	if (variant.audio && group.length) {
		const [lang, name] = row.audio.split('|');
		const pick = group.find((a) => a.lang === lang && a.name === name) ?? group.find((a) => lang && a.lang === lang) ?? group.find((a) => a.isDefault) ?? group[0];
		audio = mediaPlaylist(await (await get(pick.url, signal)).text(), pick.url);
	}
	return { plain: null, video, audio, duration: video.duration };
}

/* ------------------------------------------------------------------ downloading */

const keys = new Map<string, Promise<Uint8Array>>();
function keyFor(key: Key, signal: AbortSignal): Promise<Uint8Array> {
	let found = keys.get(key.url);
	if (!found) {
		found = get(key.url, signal).then(async (r) => new Uint8Array(await r.arrayBuffer()));
		keys.set(key.url, found);
		found.catch(() => keys.delete(key.url));
	}
	return found;
}

/** One piece onto the disk (through a .part file, so a half-written one is never taken for done). */
async function fetchPiece(piece: Piece, file: string, signal: AbortSignal): Promise<number> {
	const resp = await get(piece.url, signal, piece.range);
	if (!resp.ok) throw Object.assign(new Error(`Piece answered ${resp.status}`), { status: resp.status });
	let bytes = new Uint8Array(await resp.arrayBuffer());
	if (piece.key) {
		const iv = piece.key.iv ?? Buffer.from(piece.sequence.toString(16).padStart(32, '0'), 'hex');
		const decipher = createDecipheriv('aes-128-cbc', await keyFor(piece.key, signal), iv);
		bytes = new Uint8Array(Buffer.concat([decipher.update(bytes), decipher.final()]));
	}
	writeFileSync(`${file}.part`, bytes);
	renameSync(`${file}.part`, file);
	return bytes.length;
}

const pieceName = (n: number) => String(n).padStart(5, '0');

async function download(row: DownloadRow, signal: AbortSignal): Promise<void> {
	const dir = folderOf(row.id);
	mkdirSync(dir, { recursive: true });
	// Made into its file already, before Catalog closed: nothing left to do.
	if (existsSync(fileOf(row.id))) {
		updateDownload(row.id, { state: 'done', bytes: statSync(fileOf(row.id)).size, finished: true });
		return;
	}
	updateDownload(row.id, { state: 'downloading', error: null });
	const progress = running!.progress;

	let plan = await planFor(row, signal, false);
	const free = freeSpace();
	// Room for it twice over (its pieces, then the finished file), and some to spare.
	if (free !== null && row.estimate && free - row.estimate * 2 < MIN_FREE) throw new Error('Not enough space on this computer');

	if (plan.plain) {
		await downloadWhole(row, plan.plain, signal);
		return;
	}

	const series: { name: 'v' | 'a'; track: (p: Plan) => Track | null }[] = [
		{ name: 'v', track: (p) => p.video },
		{ name: 'a', track: (p) => p.audio }
	];
	const jobs: { folder: string; index: number | 'init' }[] = [];
	for (const s of series) {
		const track = s.track(plan);
		if (!track) continue;
		mkdirSync(join(dir, s.name), { recursive: true });
		if (track.init) jobs.push({ folder: s.name, index: 'init' });
		track.pieces.forEach((_, i) => jobs.push({ folder: s.name, index: i }));
	}
	const fileFor = (job: (typeof jobs)[number]) => join(dir, job.folder, job.index === 'init' ? 'init.mp4' : pieceName(job.index));
	const pieceFor = (p: Plan, job: (typeof jobs)[number]) => {
		const track = (job.folder === 'v' ? p.video : p.audio)!;
		return job.index === 'init' ? track.init! : track.pieces[job.index];
	};

	const todo = jobs.filter((job) => !existsSync(fileFor(job)));
	progress.total = jobs.length;
	progress.done = jobs.length - todo.length;
	updateDownload(row.id, { totalPieces: progress.total, donePieces: progress.done, duration: plan.duration });

	// A link that ran out: a fresh one, shared by every piece that found it out.
	let refreshing: Promise<Plan> | null = null;
	const freshPlan = () => (refreshing ??= planFor(row, signal, true).finally(() => setTimeout(() => (refreshing = null), 30_000)));

	const started = Date.now();
	let gotThisTime = 0;
	let lastSave = 0;
	let at = 0;
	const worker = async () => {
		while (at < todo.length && !signal.aborted) {
			const job = todo[at++];
			let tries = 0;
			for (;;) {
				try {
					const bytes = await fetchPiece(pieceFor(plan, job), fileFor(job), signal);
					progress.bytes += bytes;
					gotThisTime += bytes;
					break;
				} catch (e) {
					if (signal.aborted) throw e;
					if (++tries >= 4) throw new Error(`A piece wouldn't download (${(e as Error).message})`);
					// Refused (the link's run out) or nothing: a new link, after a moment.
					await new Promise((r) => setTimeout(r, 2000 * tries));
					if (tries >= 2) plan = await freshPlan();
				}
			}
			progress.done++;
			progress.speed = gotThisTime / Math.max(1, (Date.now() - started) / 1000);
			if (Date.now() - lastSave > 3000) {
				lastSave = Date.now();
				updateDownload(row.id, { donePieces: progress.done, bytes: progress.bytes });
			}
		}
	};
	await Promise.all(Array.from({ length: AT_ONCE }, worker));
	if (signal.aborted) return;

	updateDownload(row.id, { state: 'finishing', donePieces: progress.done, bytes: progress.bytes });
	const made: Series[] = [];
	for (const s of series) {
		const folder = join(dir, s.name);
		if (!existsSync(folder)) continue;
		const pieces = readdirSync(folder).filter((f) => /^\d+$/.test(f)).sort().map((f) => join(folder, f));
		const init = join(folder, 'init.mp4');
		if (existsSync(init)) made.push({ init: readFileSync(init), pieces });
		else made.push(fromTs(pieces, join(dir, `${s.name}-mp4`)));
	}
	const out = fileOf(row.id);
	const size = flattenToMp4(made, `${out}.part`);
	renameSync(`${out}.part`, out);
	for (const name of ['v', 'a', 'v-mp4', 'a-mp4']) rmSync(join(dir, name), { recursive: true, force: true });
	updateDownload(row.id, { state: 'done', bytes: size, finished: true });
}

/** TS pieces (replays) as fragmented MP4, by mux.js, ready to be made into one file. */
function fromTs(pieces: string[], folder: string): Series {
	mkdirSync(folder, { recursive: true });
	const transmuxer = new muxjs.mp4.Transmuxer({ remux: true });
	let init: Uint8Array | null = null;
	const out: string[] = [];
	transmuxer.on('data', (segment: { initSegment: Uint8Array; data: Uint8Array }) => {
		init ??= segment.initSegment.slice();
		const file = join(folder, pieceName(out.length));
		writeFileSync(file, segment.data);
		out.push(file);
	});
	for (const piece of pieces) {
		transmuxer.push(readFileSync(piece));
		transmuxer.flush();
	}
	if (!init) throw new Error("The video's pieces couldn't be read");
	return { init, pieces: out };
}

/** A video that's one plain file (not pieces): downloaded in parts of 8 MB, carrying on where it stopped. */
async function downloadWhole(row: DownloadRow, address: string, signal: AbortSignal): Promise<void> {
	const out = fileOf(row.id);
	const part = `${out}.part`;
	const progress = running!.progress;
	const head = await get(address, signal, [0, 1]);
	const total = Number(head.headers.get('content-range')?.split('/')[1] ?? 0);
	head.body?.cancel().catch(() => {});
	if (!total) throw new Error("The video's server won't say how big it is");
	const STEP = 8 * 1024 ** 2;
	progress.total = Math.ceil(total / STEP);
	let have = existsSync(part) ? statSync(part).size : 0;
	const fd = openSync(part, have ? 'r+' : 'w');
	try {
		while (have < total && !signal.aborted) {
			const resp = await get(address, signal, [have, Math.min(STEP, total - have)]);
			if (!resp.ok) throw new Error(`The video's server answered ${resp.status}`);
			const bytes = new Uint8Array(await resp.arrayBuffer());
			writeSync(fd, bytes, 0, bytes.length, have);
			have += bytes.length;
			progress.bytes = have;
			progress.done = Math.ceil(have / STEP);
			updateDownload(row.id, { donePieces: progress.done, totalPieces: progress.total, bytes: have });
		}
	} finally {
		closeSync(fd);
	}
	if (signal.aborted) return;
	renameSync(part, out);
	updateDownload(row.id, { state: 'done', bytes: total, finished: true });
}

/** Re-exported for the API, so it has one place to read downloads from. */
export { getDownload, listDownloads };
