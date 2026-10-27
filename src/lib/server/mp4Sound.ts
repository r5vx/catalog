/**
 * A download's sound in small pieces, for auto-timing its subtitles with no internet (Downloads,
 * 2026-10-26). Auto-timing hears a video's separate sound track as HLS pieces, as Showbox sends
 * them (src/lib/soundTrack.ts); a download is one ordinary MP4 (mp4Flatten.ts). So its sound
 * track's sample tables are read from the file, and each 10-second stretch is handed out as a
 * fragmented-MP4 piece, with an init describing the track: the same shape Showbox's has.
 */
import { closeSync, openSync, readSync } from 'node:fs';
import { box, boxesIn, bytesOf, childOf, concat, fullBox, inside, text, u32, u64, type Box } from './mp4Flatten';

type Sound = {
	init: Uint8Array;
	timescale: number;
	offsets: number[];
	sizes: number[];
	durations: number[];
	/** Each piece's first sample, and one past its last. */
	pieces: [number, number][];
	/** Each piece's start, in the track's timescale. */
	starts: number[];
};

const PIECE_SECONDS = 10;
const known = new Map<string, Sound | null>();

function readAt(fd: number, at: number, length: number): Uint8Array {
	const bytes = Buffer.alloc(length);
	readSync(fd, bytes, 0, length, at);
	return bytes;
}

/** The file's moov (written at the front by mp4Flatten.ts; looked for after the boxes before it). */
function moovOf(fd: number): Uint8Array | null {
	let at = 0;
	for (let i = 0; i < 8; i++) {
		const head = readAt(fd, at, 16);
		let size = u32(head, 0);
		if (size === 1) size = u64(head, 8);
		if (size < 8) return null;
		if (text(head, 4) === 'moov') return readAt(fd, at, size);
		at += size;
	}
	return null;
}

function soundOf(file: string): Sound | null {
	if (known.has(file)) return known.get(file)!;
	let sound: Sound | null = null;
	const fd = openSync(file, 'r');
	try {
		const moov = moovOf(fd);
		if (moov) sound = readSound(moov);
	} finally {
		closeSync(fd);
	}
	known.set(file, sound);
	return sound;
}

function readSound(moov: Uint8Array): Sound | null {
	const whole: Box = { type: 'moov', start: 0, size: moov.length, header: 8 };
	const mvhd = childOf(moov, whole, 'mvhd');
	for (const trak of inside(moov, whole).filter((b) => b.type === 'trak')) {
		const mdia = childOf(moov, trak, 'mdia')!;
		const hdlr = childOf(moov, mdia, 'hdlr')!;
		if (text(moov, hdlr.start + hdlr.header + 8) !== 'soun') continue;
		const mdhd = childOf(moov, mdia, 'mdhd')!;
		const mv = moov[mdhd.start + mdhd.header];
		const timescale = u32(moov, mdhd.start + mdhd.header + 4 + (mv === 1 ? 16 : 8));
		const minf = childOf(moov, mdia, 'minf')!;
		const stbl = childOf(moov, minf, 'stbl')!;
		const table = (type: string) => childOf(moov, stbl, type);

		// Durations (stts), sizes (stsz), samples per chunk (stsc), chunk offsets (stco/co64).
		const durations: number[] = [];
		const stts = table('stts')!;
		for (let i = 0, n = u32(moov, stts.start + 12); i < n; i++) {
			const at = stts.start + 16 + i * 8;
			for (let k = u32(moov, at); k > 0; k--) durations.push(u32(moov, at + 4));
		}
		const stsz = table('stsz')!;
		const fixed = u32(moov, stsz.start + 12);
		const count = u32(moov, stsz.start + 16);
		const sizes = Array.from({ length: count }, (_, i) => fixed || u32(moov, stsz.start + 20 + i * 4));
		const stco = table('stco');
		const co64 = table('co64');
		const chunkOffsets: number[] = [];
		if (stco) for (let i = 0, n = u32(moov, stco.start + 12); i < n; i++) chunkOffsets.push(u32(moov, stco.start + 16 + i * 4));
		else if (co64) for (let i = 0, n = u32(moov, co64.start + 12); i < n; i++) chunkOffsets.push(u64(moov, co64.start + 16 + i * 8));
		const stsc = table('stsc')!;
		const runs: [number, number][] = [];
		for (let i = 0, n = u32(moov, stsc.start + 12); i < n; i++) runs.push([u32(moov, stsc.start + 16 + i * 12), u32(moov, stsc.start + 20 + i * 12)]);
		const offsets: number[] = [];
		let sample = 0;
		chunkOffsets.forEach((chunkAt, c) => {
			const run = runs.filter((r) => r[0] <= c + 1).pop();
			let at = chunkAt;
			for (let k = run ? run[1] : 0; k > 0 && sample < count; k--) {
				offsets.push(at);
				at += sizes[sample++];
			}
		});

		const pieces: [number, number][] = [];
		const starts: number[] = [];
		let time = 0;
		let first = 0;
		for (let i = 0; i < count; i++) {
			if (time - (starts[starts.length - 1] ?? 0) >= PIECE_SECONDS * timescale || i === 0) {
				if (i > 0) pieces.push([first, i]);
				first = i;
				starts.push(time);
			}
			time += durations[i] ?? 0;
		}
		if (count) pieces.push([first, count]);

		return { init: initFor(moov, trak, mvhd ?? null), timescale, offsets, sizes, durations, pieces, starts };
	}
	return null;
}

/** ftyp + a moov with only this track, its sample tables empty, and an mvex: as Showbox's sound init. */
function initFor(moov: Uint8Array, trak: Box, mvhd: Box | null): Uint8Array {
	const parts: Uint8Array[] = [];
	for (const child of inside(moov, trak)) {
		const bytes = bytesOf(moov, child).slice();
		if (child.type === 'tkhd') {
			new DataView(bytes.buffer).setUint32(8 + 4 + (bytes[8] === 1 ? 16 : 8), 1);
			parts.push(bytes);
		} else if (child.type === 'mdia') {
			const mdia: Uint8Array[] = [];
			for (const m of boxesIn(bytes, 8)) {
				if (m.type !== 'minf') {
					mdia.push(bytesOf(bytes, m));
					continue;
				}
				const minf: Uint8Array[] = [];
				for (const n of boxesIn(bytes, m.start + 8, m.start + m.size)) {
					if (n.type !== 'stbl') minf.push(bytesOf(bytes, n));
					else {
						const stsd = boxesIn(bytes, n.start + 8, n.start + n.size).find((x) => x.type === 'stsd')!;
						minf.push(
							box('stbl', bytesOf(bytes, stsd), fullBox('stts', 0, [0]), fullBox('stsc', 0, [0]), fullBox('stsz', 0, [0, 0]), fullBox('stco', 0, [0]))
						);
					}
				}
				mdia.push(box('minf', ...minf));
			}
			parts.push(box('mdia', ...mdia));
		} else if (child.type !== 'edts') parts.push(bytes);
	}
	const ftyp = box('ftyp', new TextEncoder().encode('iso6'), new Uint8Array(4), new TextEncoder().encode('iso6mp41'));
	const head = mvhd ? bytesOf(moov, mvhd).slice() : null;
	if (head) new DataView(head.buffer).setUint32(head.length - 4, 2);
	const mvex = box('mvex', fullBox('trex', 0, [1, 1, 0, 0, 0]));
	return concat([ftyp, box('moov', ...(head ? [head] : []), box('trak', ...parts), mvex)]);
}

/** A playlist for the track: piece addresses are `base` + the piece's number. */
export function soundPlaylist(file: string, base: string): string | null {
	const sound = soundOf(file);
	if (!sound) return null;
	const lines = ['#EXTM3U', '#EXT-X-VERSION:7', `#EXT-X-TARGETDURATION:${PIECE_SECONDS + 1}`, '#EXT-X-PLAYLIST-TYPE:VOD', `#EXT-X-MAP:URI="${base}init"`];
	sound.pieces.forEach(([first, end], i) => {
		const length = sound.durations.slice(first, end).reduce((s, d) => s + d, 0) / sound.timescale;
		lines.push(`#EXTINF:${length.toFixed(5)},`, `${base}${i}`);
	});
	lines.push('#EXT-X-ENDLIST');
	return lines.join('\n');
}

export function soundInit(file: string): Uint8Array | null {
	return soundOf(file)?.init ?? null;
}

/** Piece `n` of the track: one moof (track 1, its samples' durations and sizes) and their mdat. */
export function soundPiece(file: string, n: number): Uint8Array | null {
	const sound = soundOf(file);
	const piece = sound?.pieces[n];
	if (!sound || !piece) return null;
	const [first, end] = piece;
	const fd = openSync(file, 'r');
	let data: Uint8Array;
	try {
		data = concat(Array.from({ length: end - first }, (_, k) => readAt(fd, sound.offsets[first + k], sound.sizes[first + k])));
	} finally {
		closeSync(fd);
	}
	const entries: number[] = [];
	for (let i = first; i < end; i++) entries.push(sound.durations[i], sound.sizes[i]);
	const moofWith = (dataOffset: number) => {
		const tfhd = fullBox('tfhd', 0, [1]);
		tfhd[9] = 0x02; // default-base-is-moof (flags 0x020000)
		const start = sound.starts[n];
		const tfdt = fullBox('tfdt', 1, [Math.floor(start / 2 ** 32), start % 2 ** 32]);
		const trun = fullBox('trun', 0, [end - first, dataOffset, ...entries]);
		trun[10] = 0x03; // sample duration and size present
		trun[11] = 0x01; // data offset present
		return box('moof', fullBox('mfhd', 0, [n + 1]), box('traf', tfhd, tfdt, trun));
	};
	const size = moofWith(0).length;
	return concat([moofWith(size + 8), box('mdat', data)]);
}
