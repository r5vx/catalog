/**
 * Reading a video file at a web address a piece at a time (Range requests): its tracks and the
 * subtitles inside it, through mkv.ts. Used for Nyaa's picks, which come from a debrid service
 * as a plain link (sources/nyaa.ts): the player plays the link itself, and this reads the file's
 * own subtitle tracks out of it alongside (the player never shows a file's own tracks).
 *
 * Read in 4 MB blocks, a few kept, so walking the file from start to end asks each block once.
 */
import { readInfo, SubtitleReader, type MkvInfo, type Reader } from './mkv';

const BLOCK = 4 * 1024 * 1024;
const KEEP_BLOCKS = 4;

type Opened = { size: number; read: Reader; info: Promise<MkvInfo | null>; subs: SubtitleReader | null; usedAt: number };
const opened = new Map<string, Opened>();

async function sizeOf(url: string): Promise<number> {
	const resp = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15_000) });
	await resp.body?.cancel().catch(() => {});
	const total = resp.headers.get('content-range')?.match(/\/(\d+)$/)?.[1];
	return total ? Number(total) : Number(resp.headers.get('content-length') ?? 0);
}

function blockReader(url: string, size: number): Reader {
	const blocks = new Map<number, Promise<Uint8Array>>();
	const block = (n: number) => {
		let b = blocks.get(n);
		if (!b) {
			const start = n * BLOCK;
			const end = Math.min(size, start + BLOCK) - 1;
			b = fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(60_000) }).then(async (resp) => {
				if (resp.status !== 206 && !(resp.status === 200 && start === 0)) throw new Error(`answered ${resp.status}`);
				return new Uint8Array(await resp.arrayBuffer()).subarray(0, end - start + 1);
			});
			b.catch(() => blocks.delete(n));
			blocks.set(n, b);
			while (blocks.size > KEEP_BLOCKS) blocks.delete(blocks.keys().next().value as number);
		}
		return b;
	};
	return async (start, end) => {
		end = Math.min(end, size);
		if (end <= start) return new Uint8Array(0);
		const first = Math.floor(start / BLOCK);
		const last = Math.floor((end - 1) / BLOCK);
		const out = new Uint8Array(end - start);
		for (let n = first; n <= last; n++) {
			const data = await block(n);
			const from = Math.max(start, n * BLOCK);
			const to = Math.min(end, n * BLOCK + data.length);
			out.set(data.subarray(from - n * BLOCK, to - n * BLOCK), from - start);
		}
		return out;
	};
}

/** Files not asked about for this long are let go. */
const IDLE = 30 * 60 * 1000;

async function open(key: string, url: string): Promise<Opened | null> {
	for (const [k, o] of opened) if (Date.now() - o.usedAt > IDLE) opened.delete(k);
	let o = opened.get(key);
	if (!o) {
		const size = await sizeOf(url).catch(() => 0);
		if (!size) return null;
		const read = blockReader(url, size);
		o = { size, read, info: readInfo(read, size).catch(() => null), subs: null, usedAt: Date.now() };
		opened.set(key, o);
	}
	o.usedAt = Date.now();
	return o;
}

/** The tracks of the .mkv at `url` (null when it isn't one, or can't be read). `key` names the file. */
export async function linkInfo(key: string, url: string): Promise<MkvInfo | null> {
	return (await open(key, url))?.info ?? null;
}

/** Reading the file's own subtitle lines (all of it is read, in order, in the background). */
export async function linkSubtitles(key: string, url: string): Promise<{ info: MkvInfo; reader: SubtitleReader } | null> {
	const o = await open(key, url);
	const info = o ? await o.info : null;
	if (!o || !info) return null;
	o.subs ??= new SubtitleReader(info, o.read, () => true);
	// (Carries on reading; the player asks again until it's all there.)
	await Promise.race([o.subs.step().catch(() => false), new Promise((r) => setTimeout(r, 5000))]);
	return { info, reader: o.subs };
}
