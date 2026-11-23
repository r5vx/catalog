/**
 * Picture subtitles read into text. DVD-style subtitles (VobSub: an .idx with a .sub, or an MKV's
 * S_VOBSUB track) are pictures of each line, not text, so Catalog couldn't show them; Jungle King
 * Tar-chan's only English subtitles are like that (ARR's, on Kitsunekko and inside its MKVs).
 *
 * Each line's picture is drawn black on white and read with Tesseract (tesseract.js, on this
 * computer, no outside service). The result is ordinary SRT, kept, so it's read once per file and
 * then shown, styled and auto-timed like any other subtitle.
 *
 * About 0.1–0.3 s a line: a 25-minute episode (~350 lines) takes a minute or two the first time.
 */
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { MkvTrack, SubLine } from './mkv';

/* ------------------------------------------------------------------ the .idx */

export type VobIndex = { width: number; height: number; palette: number[]; entries: { ms: number; pos: number }[] };

export function parseIdx(text: string): VobIndex {
	const size = text.match(/^size:\s*(\d+)x(\d+)/m);
	const palette = (text.match(/^palette:\s*(.+)$/m)?.[1] ?? '')
		.split(',')
		.map((c) => parseInt(c.trim(), 16))
		.filter((n) => Number.isFinite(n));
	const entries: { ms: number; pos: number }[] = [];
	// Only the first language's lines (an .idx can hold several).
	let id = 0;
	for (const line of text.split(/\r?\n/)) {
		if (/^id:/.test(line)) id++;
		if (id > 1) break;
		const m = line.match(/^timestamp:\s*(-?)(\d+):(\d+):(\d+):(\d+),\s*filepos:\s*([0-9a-f]+)/i);
		if (!m) continue;
		const ms = (m[1] ? -1 : 1) * (((+m[2] * 60 + +m[3]) * 60 + +m[4]) * 1000 + +m[5]);
		entries.push({ ms, pos: parseInt(m[6], 16) });
	}
	return { width: +(size?.[1] ?? 720), height: +(size?.[2] ?? 480), palette: palette.length >= 16 ? palette : DEFAULT_PALETTE, entries };
}
const DEFAULT_PALETTE = [0x000000, 0xffffff, 0x000000, 0x808080, ...Array(12).fill(0x808080)];

/** One line's packet, joined from the .sub's MPEG pieces that start at `pos`. */
export function spuAt(sub: Buffer, pos: number): Buffer | null {
	const parts: Buffer[] = [];
	let need = 0;
	let have = 0;
	let at = pos;
	while (at + 4 < sub.length) {
		if (sub.readUInt32BE(at) !== 0x000001ba) {
			at++;
			continue;
		}
		// The pack header: MPEG-2 (14 bytes + stuffing) or MPEG-1 (12 bytes).
		const mpeg2 = (sub[at + 4] & 0xc0) === 0x40;
		let p = at + (mpeg2 ? 14 + (sub[at + 13] & 7) : 12);
		const packEnd = Math.min(sub.length, at + 2048);
		while (p + 6 <= packEnd && sub.readUInt32BE(p) >>> 8 === 0x000001) {
			const stream = sub[p + 3];
			const length = sub.readUInt16BE(p + 4);
			const end = p + 6 + length;
			if (stream === 0xbd) {
				const headerLength = mpeg2 ? sub[p + 8] : 0;
				const start = p + 9 + headerLength + 1; // (+1: the subtitle stream's own number)
				const payload = sub.subarray(start, Math.min(end, sub.length));
				if (!need) need = payload.length >= 2 ? payload.readUInt16BE(0) : 0;
				parts.push(payload);
				have += payload.length;
				if (need && have >= need) return Buffer.concat(parts).subarray(0, need);
			}
			p = end;
		}
		at = packEnd;
	}
	return need && have ? Buffer.concat(parts).subarray(0, need) : null;
}

/* ------------------------------------------------------------------ a line's picture */

export type SpuPicture = { startMs: number; stopMs: number | null; width: number; height: number; pixels: Uint8Array; colors: number[]; alpha: number[] };

/** Decodes one packet: when it shows and hides (from its time), and its 4-colour picture. */
export function decodeSpu(spu: Buffer): SpuPicture | null {
	if (spu.length < 4) return null;
	const size = spu.readUInt16BE(0);
	let ctrl = spu.readUInt16BE(2);
	let startMs = 0;
	let stopMs: number | null = null;
	let colors = [0, 1, 2, 3];
	let alpha = [0, 15, 15, 15];
	let x1 = 0, x2 = 0, y1 = 0, y2 = 0, top = 0, bottom = 0;
	for (let guard = 0; guard < 64 && ctrl + 4 <= Math.min(size, spu.length); guard++) {
		const delayMs = (spu.readUInt16BE(ctrl) * 1024) / 90;
		const next = spu.readUInt16BE(ctrl + 2);
		let p = ctrl + 4;
		while (p < spu.length) {
			const cmd = spu[p++];
			if (cmd === 0xff) break;
			if (cmd === 0x00 || cmd === 0x01) startMs = delayMs;
			else if (cmd === 0x02) stopMs = delayMs;
			else if (cmd === 0x03) {
				colors = [spu[p + 1] & 15, spu[p + 1] >> 4, spu[p] & 15, spu[p] >> 4];
				p += 2;
			} else if (cmd === 0x04) {
				alpha = [spu[p + 1] & 15, spu[p + 1] >> 4, spu[p] & 15, spu[p] >> 4];
				p += 2;
			} else if (cmd === 0x05) {
				x1 = (spu[p] << 4) | (spu[p + 1] >> 4);
				x2 = ((spu[p + 1] & 15) << 8) | spu[p + 2];
				y1 = (spu[p + 3] << 4) | (spu[p + 4] >> 4);
				y2 = ((spu[p + 4] & 15) << 8) | spu[p + 5];
				p += 6;
			} else if (cmd === 0x06) {
				top = spu.readUInt16BE(p);
				bottom = spu.readUInt16BE(p + 2);
				p += 4;
			} else break; // (not a command this knows: the rest can't be read)
		}
		if (next === ctrl) break;
		ctrl = next;
	}
	const width = x2 - x1 + 1;
	const height = y2 - y1 + 1;
	if (width <= 0 || height <= 0 || width > 4096 || height > 4096 || !top) return null;
	const pixels = new Uint8Array(width * height);
	// The picture's two halves: even rows from `top`, odd rows from `bottom`, each run-length coded in nibbles.
	for (const [field, offset] of [[0, top], [1, bottom]] as const) {
		let nibble = offset * 2;
		const read = () => {
			const byte = spu[nibble >> 1] ?? 0;
			const v = nibble & 1 ? byte & 15 : byte >> 4;
			nibble++;
			return v;
		};
		for (let y = field; y < height; y += 2) {
			let x = 0;
			while (x < width) {
				let v = read();
				if (v < 0x4) {
					v = (v << 4) | read();
					if (v < 0x10) {
						v = (v << 4) | read();
						if (v < 0x40) v = (v << 4) | read();
					}
				}
				const run = v >> 2 || width - x;
				pixels.fill(v & 3, y * width + x, y * width + Math.min(width, x + run));
				x += run;
			}
			if (nibble & 1) nibble++; // each row starts on a whole byte
		}
	}
	return { startMs, stopMs, width, height, pixels, colors, alpha };
}

/**
 * The picture as black text on white, twice the size with a margin (what Tesseract reads best),
 * as a 24-bit BMP. The text is the brightest colour that shows; the outline and the rest are white.
 */
export function readableImage(pic: SpuPicture, palette: number[]): Buffer | null {
	const lum = (rgb: number) => 0.299 * ((rgb >> 16) & 255) + 0.587 * ((rgb >> 8) & 255) + 0.114 * (rgb & 255);
	let text = -1;
	let best = -1;
	for (let s = 0; s < 4; s++) {
		if (!pic.alpha[s]) continue;
		const l = lum(palette[pic.colors[s]] ?? 0);
		if (l > best) {
			best = l;
			text = s;
		}
	}
	// Only the part with text in it (a line's picture is often the whole screen: 2 s a line to read).
	let left = pic.width, right = -1, topRow = pic.height, bottomRow = -1;
	for (let y = 0; y < pic.height; y++) {
		for (let x = 0; x < pic.width; x++) {
			if (pic.pixels[y * pic.width + x] !== text) continue;
			if (x < left) left = x;
			if (x > right) right = x;
			if (y < topRow) topRow = y;
			if (y > bottomRow) bottomRow = y;
		}
	}
	if (right < 0) return null;
	const scale = 2;
	const margin = 12;
	const w = (right - left + 1) * scale + margin * 2;
	const h = (bottomRow - topRow + 1) * scale + margin * 2;
	const row = Math.ceil((w * 3) / 4) * 4;
	const bmp = Buffer.alloc(54 + row * h, 255);
	bmp.write('BM', 0);
	bmp.writeUInt32LE(bmp.length, 2);
	bmp.writeUInt32LE(54, 10);
	bmp.writeUInt32LE(40, 14);
	bmp.writeInt32LE(w, 18);
	bmp.writeInt32LE(h, 22);
	bmp.writeUInt16LE(1, 26);
	bmp.writeUInt16LE(24, 28);
	bmp.writeUInt32LE(row * h, 34);
	for (let y = topRow; y <= bottomRow; y++) {
		for (let x = left; x <= right; x++) {
			if (pic.pixels[y * pic.width + x] !== text) continue;
			for (let dy = 0; dy < scale; dy++) {
				const outY = h - 1 - (margin + (y - topRow) * scale + dy); // (BMP rows go bottom to top)
				const base = 54 + outY * row + (margin + (x - left) * scale) * 3;
				bmp.fill(0, base, base + scale * 3);
			}
		}
	}
	return bmp;
}

/* ------------------------------------------------------------------ reading */

type Worker = { recognize: (image: Buffer) => Promise<{ data: { text: string } }>; setParameters: (p: Record<string, string>) => Promise<unknown>; terminate: () => Promise<unknown> };
let worker: Promise<Worker> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** Tesseract, started once and stopped after 5 idle minutes (it holds ~100 MB). */
function reader(): Promise<Worker> {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = setTimeout(() => {
		const w = worker;
		worker = null;
		void w?.then((x) => x.terminate()).catch(() => {});
	}, 5 * 60 * 1000);
	idleTimer.unref?.();
	if (!worker) {
		worker = (async () => {
			const { createWorker } = await import('tesseract.js');
			// The English data comes with Catalog (@tesseract.js-data/eng): nothing is downloaded.
			const require = createRequire(import.meta.url);
			const langPath = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
			const w = (await createWorker('eng', 1, { langPath, gzip: true, cacheMethod: 'none' })) as unknown as Worker;
			// One block of text; only the characters subtitles use.
			await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
			return w;
		})();
		worker.catch(() => (worker = null));
	}
	return worker;
}

/** Tesseract's usual slips on subtitle lettering, put right. */
const tidy = (text: string) =>
	text
		.replace(/\r/g, '')
		.split('\n')
		.map((l) => l.replace(/\s+/g, ' ').replace(/(^|\s)\|(?=['’]?\w*\b|\s|$)/g, '$1I').replace(/^[|_]+\s*|\s*[|_]+$/g, '').replace(/\bl(?=[A-Z])/g, 'I').replace(/(^|\s)l(\s|$)/g, '$1I$2').replace(/``|''/g, '"').trim())
		.filter(Boolean)
		.join('\n');

export type Cue = { start: number; end: number; text: string };

const srtTime = (ms: number) => {
	const t = Math.max(0, Math.round(ms));
	const p = (n: number, w = 2) => String(n).padStart(w, '0');
	return `${p(Math.floor(t / 3600000))}:${p(Math.floor(t / 60000) % 60)}:${p(Math.floor(t / 1000) % 60)},${p(t % 1000, 3)}`;
};
export const toSrt = (cues: Cue[]) => cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');

/**
 * Reads every line of a set of pictures: `lines` gives each one's time and packet. `onProgress`
 * hears how many are done. Lines that read as nothing are left out.
 */
export async function readPictures(lines: { ms: number; spu: Buffer; duration?: number }[], palette: number[], onProgress?: (done: number, of: number) => void, count = lines.length): Promise<Cue[]> {
	if (!lines.length) return [];
	const w = await reader();
	const cues: Cue[] = [];
	for (let i = 0; i < Math.min(count, lines.length); i++) {
		const pic = decodeSpu(lines[i].spu);
		if (pic) {
			const start = lines[i].ms + pic.startMs;
			const nextStart = lines[i + 1]?.ms ?? start + 5000;
			const end = pic.stopMs !== null && pic.stopMs > pic.startMs ? lines[i].ms + pic.stopMs
				: lines[i].duration !== undefined ? lines[i].ms + lines[i].duration! : Math.min(nextStart, start + 5000);
			const image = readableImage(pic, palette);
			const text = image ? tidy((await w.recognize(image)).data.text) : '';
			if (text) cues.push({ start, end: Math.max(end, start + 300), text });
		}
		onProgress?.(i + 1, lines.length);
	}
	return cues;
}

/** An MKV's VobSub blocks are whole packets; its setup is the .idx header. */
export async function readMkvPictures(track: MkvTrack, lines: SubLine[], count?: number): Promise<Cue[]> {
	const index = parseIdx(new TextDecoder().decode(track.codecPrivate ?? new Uint8Array()));
	const packets = lines.filter((l) => l.track === track.number && l.bytes).map((l) => ({
		ms: l.start * 1000, spu: Buffer.from(l.bytes!), ...(l.duration !== undefined ? { duration: l.duration * 1000 } : {})
	}));
	return readPictures(packets, index.palette, undefined, count);
}

/** An .idx and .sub pair read into SRT. */
export async function readVobSub(idx: string, sub: Buffer, onProgress?: (done: number, of: number) => void): Promise<string> {
	const index = parseIdx(idx);
	const lines = index.entries.map((e) => ({ ms: e.ms, spu: spuAt(sub, e.pos) })).filter((l): l is { ms: number; spu: Buffer } => Boolean(l.spu));
	return toSrt(await readPictures(lines, index.palette, onProgress));
}
