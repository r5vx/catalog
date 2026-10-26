/**
 * Long video pieces, handed on in short parts.
 *
 * Some sources cut their video into very long pieces: 7Movies' H.264 copies (SVU, 2026-10-17)
 * come in 36-second pieces of about 28 MB each. The player only uses a piece once all of it has
 * arrived, so on a TV that's a lot to wait for, and the Fire TV's built-in browser only holds
 * about 30 MB of video at once on smaller sticks — one piece nearly fills it, the next won't
 * fit, and it stops to load at every piece. Inside, though, each piece is several short chunks
 * (fMP4 `moof` + `mdat`, 6 s each, every one starting on a full picture), and the player is
 * happy with any of them on its own.
 *
 * So the relay's playlist lists each long piece as several parts
 * (`/api/watch/relay?u=<piece>&part=2&of=6&len=6.006&ts=90000&tk=1`). Asking for any part
 * downloads the whole piece once, here, and each part is handed out as soon as its chunks
 * have arrived. A few pieces are kept for a few minutes, so the next parts come from memory.
 */

import { noteRelayPiece } from './playbackLog';
import { trustedVideoHost } from './relayHosts';
import { keepPiece, pieceKeyOf, storedPiece, watching } from './episodeDownloads';

/** Pieces longer than this are split. */
const LONG = 12;
/** Roughly how long each part should be. */
const PART = 6;
/** No answer, or no new data, for this long counts as the video server having stopped. */
const STALL_MS = 30_000;
/**
 * No answer yet after this long: the same thing is asked for again alongside, and whichever
 * answers first is used. On 2026-10-20 one SVU piece hung for 53 s while every other came in
 * under a second — a server that's busy now and then leaves one download hanging, and the
 * video waited for it.
 */
const ASK_AGAIN_MS = 4_000;
/**
 * Once going, this long without a single new byte means it has hung (Movy's slow server still
 * sends something every moment): the download is dropped and asked for afresh.
 */
const HUNG_MS = 12_000;
const KEEP_PIECES = 4;
const KEEP_MS = 3 * 60 * 1000;

/* ------------------------------------------------ fetching without a time limit on the whole */

/**
 * The first answer to one or two tries (ASK_AGAIN_MS says when the second goes); the slower
 * try is stopped. Not for Movy, whose server refuses more than five downloads at once and is
 * already sent four.
 */
async function firstAnswer(url: URL | string, headers: Record<string, string>): Promise<{ response: Response; controller: AbortController }> {
	const address = typeof url === 'string' ? new URL(url) : url;
	const tries: AbortController[] = [];
	const ask = (): Promise<{ response: Response; controller: AbortController }> => {
		const controller = new AbortController();
		tries.push(controller);
		return fetch(address, { headers, signal: controller.signal }).then((response) => ({ response, controller }));
	};
	const giveUp = setTimeout(() => tries.forEach((t) => t.abort()), STALL_MS);
	let again: ReturnType<typeof setTimeout> | undefined;
	try {
		const first = ask();
		if (trustedVideoHost(address) === 'movy') return await first;
		const second = new Promise<{ response: Response; controller: AbortController }>((resolve, reject) => {
			again = setTimeout(() => ask().then(resolve, reject), ASK_AGAIN_MS);
		});
		// Whichever answers first; one failing still leaves the other.
		const winner = await Promise.any([first, second]).catch((e: AggregateError) => {
			throw e.errors[0];
		});
		for (const t of tries) if (t !== winner.controller) t.abort();
		return winner;
	} finally {
		clearTimeout(giveUp);
		clearTimeout(again);
	}
}

/**
 * Fetches with a limit on silence rather than on the whole download: the answer must start
 * within 30 s (asked again after 4 s), and once going, each next bit must come within 12 s. (A limit on the whole cut
 * big pieces off partway when a TV fetched them slowly — the TV then threw the piece away and
 * started it again.) `read()` only counts the time spent waiting on the video server.
 */
export async function fetchSteadily(url: URL | string, headers: Record<string, string>) {
	const { response, controller } = await firstAnswer(url, headers);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const reader = response.body?.getReader();
	const silence = trustedVideoHost(typeof url === 'string' ? new URL(url) : url) === 'movy' ? STALL_MS : HUNG_MS;
	return {
		response,
		async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
			if (!reader) return { done: true, value: undefined };
			timer = setTimeout(() => controller.abort(), silence);
			try {
				return await reader.read();
			} finally {
				clearTimeout(timer);
			}
		},
		cancel() {
			reader?.cancel().catch(() => {});
			controller.abort();
		}
	};
}

async function fetchWhole(url: string, headers: Record<string, string>): Promise<Buffer | null> {
	try {
		const answer = await fetchSteadily(url, headers);
		if (!answer.response.ok) {
			answer.cancel();
			return null;
		}
		const parts: Uint8Array[] = [];
		for (let r = await answer.read(); !r.done; r = await answer.read()) parts.push(r.value);
		return Buffer.concat(parts);
	} catch {
		return null;
	}
}

/* ------------------------------------------------ reading MP4 boxes */

type Box = { type: string; start: number; body: number; end: number };

function* boxesIn(b: Buffer, start = 0, end = b.length): Generator<Box> {
	let i = start;
	while (i + 8 <= end) {
		let size = b.readUInt32BE(i);
		let header = 8;
		if (size === 1) {
			if (i + 16 > end) return;
			size = Number(b.readBigUInt64BE(i + 8));
			header = 16;
		} else if (size === 0) size = end - i;
		if (size < header || i + size > end) return;
		yield { type: b.toString('latin1', i + 4, i + 8), start: i, body: i + header, end: i + size };
		i += size;
	}
}

const child = (b: Buffer, box: Box, type: string) => [...boxesIn(b, box.body, box.end)].find((x) => x.type === type);

/** The video track's number and clock (ticks per second), from a stream's opening piece (EXT-X-MAP). */
function videoClock(init: Buffer): { track: number; timescale: number } | null {
	const moov = [...boxesIn(init)].find((x) => x.type === 'moov');
	if (!moov) return null;
	for (const trak of boxesIn(init, moov.body, moov.end)) {
		if (trak.type !== 'trak') continue;
		const tkhd = child(init, trak, 'tkhd');
		const mdia = child(init, trak, 'mdia');
		const hdlr = mdia && child(init, mdia, 'hdlr');
		const mdhd = mdia && child(init, mdia, 'mdhd');
		if (!tkhd || !hdlr || !mdhd) continue;
		if (init.toString('latin1', hdlr.body + 8, hdlr.body + 12) !== 'vide') continue;
		const tkhdOld = init[tkhd.body] === 0;
		const track = init.readUInt32BE(tkhd.body + (tkhdOld ? 12 : 20));
		const timescale = init.readUInt32BE(mdhd.body + (init[mdhd.body] === 0 ? 12 : 20));
		return timescale ? { track, timescale } : null;
	}
	return null;
}

/** When a chunk starts on the video track's clock (its `tfdt`), or null if it can't be read. */
function chunkTime(b: Buffer, moof: Box, track: number): number | null {
	for (const traf of boxesIn(b, moof.body, moof.end)) {
		if (traf.type !== 'traf') continue;
		const tfhd = child(b, traf, 'tfhd');
		if (!tfhd || b.readUInt32BE(tfhd.body + 4) !== track) continue;
		// A piece whose chunks point at places in the whole piece can't be cut up.
		if (b.readUInt32BE(tfhd.body) & 1) return null;
		const tfdt = child(b, traf, 'tfdt');
		if (!tfdt) return null;
		return b[tfdt.body] === 1 ? Number(b.readBigUInt64BE(tfdt.body + 4)) : b.readUInt32BE(tfdt.body + 4);
	}
	return null;
}

/* ------------------------------------------------ the playlist */

const clocks = new Map<string, Promise<{ track: number; timescale: number } | null>>();

/**
 * A playlist with its long pieces listed as short parts. `address(url)` gives the relay
 * address for a file (null for one the player fetches itself: left whole). Playlists this can't safely do (no long pieces, not fMP4, locked or
 * already cut by byte ranges) come back as they were.
 */
export async function splitLongPieces(
	lines: string[],
	base: URL,
	headers: Record<string, string>,
	address: (url: string) => string | null
): Promise<string[]> {
	const durations = lines.filter((l) => l.startsWith('#EXTINF:')).map((l) => parseFloat(l.slice(8)));
	if (!durations.some((d) => d > LONG)) return lines;
	if (lines.some((l) => l.startsWith('#EXT-X-BYTERANGE') || (l.startsWith('#EXT-X-KEY') && !/METHOD=NONE/.test(l)))) return lines;
	const map = lines.find((l) => l.startsWith('#EXT-X-MAP'))?.match(/URI="([^"]+)"/)?.[1];
	if (!map) return lines;

	const mapUrl = new URL(map, base).href;
	if (!clocks.has(mapUrl)) {
		clocks.set(mapUrl, fetchWhole(mapUrl, headers).then((init) => (init ? videoClock(init) : null)));
	}
	const clock = await clocks.get(mapUrl)!;
	if (!clock) {
		clocks.delete(mapUrl);
		return lines;
	}

	const out: string[] = [];
	let longest = 0;
	let held: number | null = null;
	let previousLong = '';
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('#EXTINF:')) {
			const seconds = parseFloat(trimmed.slice(8));
			if (seconds > LONG) {
				held = seconds;
				continue;
			}
			longest = Math.max(longest, seconds);
		} else if (held !== null && trimmed && !trimmed.startsWith('#')) {
			const relayed = address(new URL(trimmed, base).href);
			if (!relayed) {
				out.push(`#EXTINF:${held},`, line);
				longest = Math.max(longest, held);
				held = null;
				continue;
			}
			// Which long piece comes after which: the next is fetched as the player nears the end.
			const piece = new URL(trimmed, base).href;
			if (previousLong) nextLong.set(previousLong, piece);
			previousLong = piece;
			if (nextLong.size > 5000) nextLong.delete(nextLong.keys().next().value!);
			const of = Math.round(held / PART);
			const len = held / of;
			for (let part = 0; part < of; part++) {
				const params = new URLSearchParams({ part: String(part), of: String(of), len: len.toFixed(4), ts: String(clock.timescale), tk: String(clock.track) });
				out.push(`#EXTINF:${len.toFixed(3)},`, `${relayed}&${params}`);
			}
			longest = Math.max(longest, len);
			held = null;
			continue;
		}
		out.push(line);
	}
	return out.map((l) => (l.startsWith('#EXT-X-TARGETDURATION:') ? `#EXT-X-TARGETDURATION:${Math.ceil(longest)}` : l));
}

/* ------------------------------------------------ the pieces */

type Chunk = { at: number; bytes: Buffer };
type Piece = {
	chunks: Chunk[];
	/** Where the latest chunk to start arriving begins (seconds into the piece; -1 before any). */
	reached: number;
	/** The piece as it came, if it turns out not to be cut-up-able: then it's handed out whole. */
	raw: Buffer[];
	unreadable: boolean;
	done: boolean;
	failed: boolean;
	usedAt: number;
	/** Resolves (and is replaced) whenever something new has arrived. */
	news: Promise<void>;
	tell: () => void;
};

const pieces = new Map<string, Piece>();
/** The long piece after each one in its playlist. */
const nextLong = new Map<string, string>();

function forgetOld() {
	const now = Date.now();
	for (const [url, piece] of pieces) {
		if (now - piece.usedAt > KEEP_MS && (piece.done || piece.failed)) pieces.delete(url);
	}
	const finished = [...pieces].filter(([, p]) => p.done || p.failed).sort((a, b) => a[1].usedAt - b[1].usedAt);
	while (pieces.size > KEEP_PIECES && finished.length) pieces.delete(finished.shift()![0]);
}

/**
 * Downloads a piece, cutting it into chunks as they arrive. A piece already downloaded ahead
 * (episodeDownloads.ts) is cut from `stored` instead, and one downloaded here is kept there.
 */
function download(url: string, headers: Record<string, string>, clock: { track: number; timescale: number }, stored: Buffer | null = null): Piece {
	let tell = () => {};
	const piece: Piece = {
		chunks: [], reached: -1, raw: [], unreadable: false, done: false, failed: false, usedAt: Date.now(),
		news: new Promise<void>((r) => (tell = r)), tell: () => {}
	};
	piece.tell = () => {
		const told = tell;
		piece.news = new Promise<void>((r) => (tell = r));
		told();
	};

	(async () => {
		let waiting: Buffer[] = [];
		let waitingLength = 0;
		let lead: Buffer[] = [];
		let current: Buffer[] | null = null;
		let currentAt = 0;
		let firstTime: number | null = null;
		const take = (n: number) => {
			const all = Buffer.concat(waiting, waitingLength);
			waiting = [all.subarray(n)];
			waitingLength -= n;
			return all.subarray(0, n);
		};
		const headerSize = (): number | null => {
			if (waitingLength < 8) return null;
			const head = waiting[0].length >= 16 ? waiting[0] : Buffer.concat(waiting, Math.min(16, waitingLength));
			const size = head.readUInt32BE(0);
			if (size === 1) return waitingLength >= 16 ? Number(head.readBigUInt64BE(8)) : null;
			return size >= 8 ? size : -1;
		};

		const started = Date.now();
		let got = 0;
		const all: Buffer[] = [];
		const fetched = stored ? null : await fetchSteadily(url, headers);
		if (fetched && !fetched.response.ok) throw new Error(`video server said ${fetched.response.status}`);
		// (Already here: handed over in one go.)
		let given = false;
		const answer = fetched ?? {
			read: async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
				if (given || !stored) return { done: true, value: undefined };
				given = true;
				return { done: false, value: new Uint8Array(stored.buffer, stored.byteOffset, stored.byteLength) };
			}
		};
		// Not cut-up-able after all: everything so far, in order, then the rest as it comes.
		const giveUp = () => {
			piece.unreadable = true;
			piece.raw = [...piece.chunks.map((c) => c.bytes), ...(current ?? []), ...lead, ...waiting];
			piece.chunks = [];
		};
		for (let r = await answer.read(); !r.done; r = await answer.read()) {
			const bytes = Buffer.from(r.value.buffer, r.value.byteOffset, r.value.byteLength);
			got += bytes.length;
			if (!stored) all.push(bytes);
			if (piece.unreadable) {
				piece.raw.push(bytes);
				continue;
			}
			waiting.push(bytes);
			waitingLength += bytes.length;
			for (let size = headerSize(); size !== null; size = headerSize()) {
				if (size < 0) {
					giveUp();
					break;
				}
				if (waitingLength < size) break;
				const box = take(size);
				const type = box.toString('latin1', 4, 8);
				if (type === 'moof') {
					const time = chunkTime(box, { type, start: 0, body: 8, end: box.length }, clock.track);
					if (time === null) {
						lead.push(box);
						giveUp();
						break;
					}
					firstTime ??= time;
					currentAt = (time - firstTime) / clock.timescale;
					current = [...lead, box];
					lead = [];
					piece.reached = currentAt;
					piece.tell();
				} else if (type === 'mdat' && current) {
					current.push(box);
					piece.chunks.push({ at: currentAt, bytes: Buffer.concat(current) });
					current = null;
					piece.tell();
				} else (current ?? lead).push(box);
			}
		}
		// Anything after the last chunk goes with it.
		const last = piece.chunks.at(-1);
		if (last && lead.length) last.bytes = Buffer.concat([last.bytes, ...lead]);
		if (!piece.unreadable && (!piece.chunks.length || current)) giveUp();
		if (!stored) {
			noteRelayPiece(url, got, Date.now() - started);
			const key = pieceKeyOf(url);
			if (key) keepPiece(key.copy, key.n, Buffer.concat(all));
		}
		piece.done = true;
		piece.tell();
	})().catch(() => {
		piece.failed = true;
		pieces.delete(url);
		piece.tell();
	});
	return piece;
}

/**
 * One part of a long piece: the chunks that start within its stretch of time. A part with no
 * chunk of its own (when the piece's chunks are longer than the parts) gets the chunk that
 * covers it — the player simply plays the same pictures over themselves. Null if the video
 * server stopped answering.
 */
export async function piecePart(
	url: string,
	headers: Record<string, string>,
	where: { part: number; of: number; len: number; timescale: number; track: number }
): Promise<Buffer | null> {
	forgetOld();
	let piece = pieces.get(url);
	const clock = { track: where.track, timescale: where.timescale };
	const key = pieceKeyOf(url);
	if (key) watching(key.copy, key.n);
	if (!piece || piece.failed) {
		piece = download(url, headers, clock, key ? storedPiece(key.copy, key.n) : null);
		pieces.set(url, piece);
	}
	piece.usedAt = Date.now();
	// Nearing its end: the next piece starts downloading, so it's here when the player gets there.
	const next = nextLong.get(url);
	if (next && where.part >= where.of - 2 && !pieces.has(next)) pieces.set(next, download(next, headers, clock));

	const partOf = (at: number) => Math.min(where.of - 1, Math.max(0, Math.floor((at + 0.05) / where.len)));
	// Ready once a later part's chunk has begun arriving, or the piece is all here.
	while (!piece.done && !piece.failed && !piece.unreadable && !(piece.reached >= 0 && partOf(piece.reached) > where.part)) {
		await piece.news;
	}
	if (piece.failed) return null;
	if (piece.unreadable) {
		while (!piece.done && !piece.failed) await piece.news;
		return piece.failed ? null : Buffer.concat(piece.raw);
	}
	const mine = piece.chunks.filter((c) => partOf(c.at) === where.part);
	if (mine.length) return Buffer.concat(mine.map((c) => c.bytes));
	const covering = piece.chunks.filter((c) => partOf(c.at) < where.part).at(-1) ?? piece.chunks[0];
	return covering.bytes;
}
