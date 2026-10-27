/**
 * Downloads (downloads.ts): a video's pieces made into one ordinary MP4 file, the kind a phone's
 * own player (an iPhone's Files app), Catalog's player and VLC all play and seek in.
 *
 * Streaming video comes as "fragmented" MP4: a start piece describing each track (`init`), then
 * many pieces of a few seconds each (a `moof` saying which samples, an `mdat` holding them).
 * Showbox sends its picture and its sound as two such series. This reads every piece's sample
 * list (pass one), works out the whole file's tables, writes them at the front (`moov`, so it
 * plays straight away), then copies every sample in order of time (pass two). Nothing is
 * re-encoded: the bytes are the source's own.
 *
 * TS pieces (replays) are turned into fragmented MP4 first, by mux.js (see downloads.ts).
 */
import { closeSync, openSync, readFileSync, readSync, writeSync } from 'node:fs';

/** One series of pieces: its init, and its pieces' files in order. */
export type Series = { init: Uint8Array; pieces: string[] };

export type Box = { type: string; start: number; size: number; header: number };

export const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
export const u64 = (b: Uint8Array, at: number) => u32(b, at) * 2 ** 32 + u32(b, at + 4);
const i32 = (b: Uint8Array, at: number) => (b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3];
export const text = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

export function boxesIn(b: Uint8Array, from = 0, to = b.length): Box[] {
	const found: Box[] = [];
	let at = from;
	while (at + 8 <= to) {
		let size = u32(b, at);
		let header = 8;
		if (size === 1) {
			size = u64(b, at + 8);
			header = 16;
		} else if (size === 0) size = to - at;
		if (size < header || at + size > to) break;
		found.push({ type: text(b, at + 4), start: at, size, header });
		at += size;
	}
	return found;
}
export const inside = (b: Uint8Array, box: Box) => boxesIn(b, box.start + box.header, box.start + box.size);
export const childOf = (b: Uint8Array, box: Box, type: string) => inside(b, box).find((c) => c.type === type);
export const bytesOf = (b: Uint8Array, box: Box) => b.subarray(box.start, box.start + box.size);

/* ------------------------------------------------------------------ writing boxes */

export function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}
export function box(type: string, ...payload: Uint8Array[]): Uint8Array {
	const body = concat(payload);
	const out = new Uint8Array(8 + body.length);
	new DataView(out.buffer).setUint32(0, out.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(body, 8);
	return out;
}
/** A box with a version and flags, then 32-bit numbers. */
export function fullBox(type: string, version: number, numbers: number[], tail?: Uint8Array): Uint8Array {
	const head = new Uint8Array(4 + numbers.length * 4);
	const view = new DataView(head.buffer);
	head[0] = version;
	numbers.forEach((n, i) => view.setUint32(4 + i * 4, n >>> 0));
	return box(type, head, tail ?? new Uint8Array());
}

/* ------------------------------------------------------------------ reading tracks */

type Track = {
	/** Its number in the finished file. */
	id: number;
	trak: Uint8Array;
	timescale: number;
	video: boolean;
	defaults: { duration: number; size: number; flags: number };
	sizes: number[];
	durations: number[];
	offsets: number[];
	syncs: number[];
	/** Runs of samples lying together in a piece: one chunk each in the finished file. */
	runs: Run[];
};
type Run = { track: Track; piece: string; at: number; bytes: number; first: number; count: number; time: number };

/** The tracks an init describes, keyed by their number in it. */
function tracksOf(init: Uint8Array, nextId: () => number): Map<number, Track> {
	const tracks = new Map<number, Track>();
	const moov = boxesIn(init).find((b) => b.type === 'moov');
	if (!moov) throw new Error('No moov in the init');
	const defaults = new Map<number, Track['defaults']>();
	const mvex = childOf(init, moov, 'mvex');
	for (const trex of mvex ? inside(init, mvex).filter((b) => b.type === 'trex') : []) {
		const at = trex.start + trex.header + 4;
		defaults.set(u32(init, at), { duration: u32(init, at + 8), size: u32(init, at + 12), flags: u32(init, at + 16) });
	}
	for (const trak of inside(init, moov).filter((b) => b.type === 'trak')) {
		const tkhd = childOf(init, trak, 'tkhd')!;
		const v = init[tkhd.start + tkhd.header];
		const oldId = u32(init, tkhd.start + tkhd.header + 4 + (v === 1 ? 16 : 8));
		const mdia = childOf(init, trak, 'mdia')!;
		const mdhd = childOf(init, mdia, 'mdhd')!;
		const mv = init[mdhd.start + mdhd.header];
		const timescale = u32(init, mdhd.start + mdhd.header + 4 + (mv === 1 ? 16 : 8));
		const hdlr = childOf(init, mdia, 'hdlr')!;
		const handler = text(init, hdlr.start + hdlr.header + 8);
		tracks.set(oldId, {
			id: nextId(),
			trak: bytesOf(init, trak).slice(),
			timescale,
			video: handler === 'vide',
			defaults: defaults.get(oldId) ?? { duration: 0, size: 0, flags: 0 },
			sizes: [],
			durations: [],
			offsets: [],
			syncs: [],
			runs: []
		});
	}
	return tracks;
}

/** Pass one: every sample of every piece, noted on its track. */
function readPieces(series: Series, tracks: Map<number, Track>): void {
	for (const piece of series.pieces) {
		const b = readFileSync(piece);
		for (const moof of boxesIn(b).filter((x) => x.type === 'moof')) {
			for (const traf of inside(b, moof).filter((x) => x.type === 'traf')) {
				const tfhd = childOf(b, traf, 'tfhd')!;
				let at = tfhd.start + tfhd.header;
				const flags = u32(b, at) & 0xffffff;
				const track = tracks.get(u32(b, at + 4));
				if (!track) continue;
				at += 8;
				let base = moof.start;
				if (flags & 0x1) {
					base = u64(b, at);
					at += 8;
				}
				if (flags & 0x2) at += 4;
				let duration = track.defaults.duration;
				let size = track.defaults.size;
				let sampleFlags = track.defaults.flags;
				if (flags & 0x8) {
					duration = u32(b, at);
					at += 4;
				}
				if (flags & 0x10) {
					size = u32(b, at);
					at += 4;
				}
				if (flags & 0x20) sampleFlags = u32(b, at);
				const tfdt = childOf(b, traf, 'tfdt');
				let time = tfdt ? (b[tfdt.start + tfdt.header] === 1 ? u64(b, tfdt.start + tfdt.header + 4) : u32(b, tfdt.start + tfdt.header + 4)) : 0;
				let dataAt = base;
				for (const trun of inside(b, traf).filter((x) => x.type === 'trun')) {
					let t = trun.start + trun.header;
					const version = b[t];
					const tf = u32(b, t) & 0xffffff;
					const count = u32(b, t + 4);
					t += 8;
					if (tf & 0x1) {
						dataAt = base + i32(b, t);
						t += 4;
					}
					let firstFlags: number | null = null;
					if (tf & 0x4) {
						firstFlags = u32(b, t);
						t += 4;
					}
					const run: Run = { track, piece, at: dataAt, bytes: 0, first: track.sizes.length, count, time: time / track.timescale };
					for (let i = 0; i < count; i++) {
						let d = duration;
						let s = size;
						let f = i === 0 && firstFlags !== null ? firstFlags : sampleFlags;
						let cto = 0;
						if (tf & 0x100) {
							d = u32(b, t);
							t += 4;
						}
						if (tf & 0x200) {
							s = u32(b, t);
							t += 4;
						}
						if (tf & 0x400) {
							f = u32(b, t);
							t += 4;
						}
						if (tf & 0x800) {
							cto = version === 1 ? i32(b, t) : u32(b, t);
							t += 4;
						}
						// (Not a sync sample: the "is non-sync" bit, or "depends on others".)
						if (!(f & 0x10000) && (f & 0x3000000) !== 0x1000000) track.syncs.push(track.sizes.length + 1);
						track.sizes.push(s);
						track.durations.push(d);
						track.offsets.push(cto);
						run.bytes += s;
						time += d;
					}
					dataAt += run.bytes;
					if (count) track.runs.push(run);
				}
			}
		}
	}
}

/* ------------------------------------------------------------------ the finished file */

/** Runs of equal values: [count, value] pairs. */
function runsOf(values: number[]): [number, number][] {
	const out: [number, number][] = [];
	for (const v of values) {
		const last = out[out.length - 1];
		if (last && last[1] === v) last[0]++;
		else out.push([1, v]);
	}
	return out;
}

function sampleTable(track: Track, stsd: Uint8Array, chunkOffsets: number[], wide: boolean): Uint8Array {
	const stts = runsOf(track.durations);
	const parts = [stsd, fullBox('stts', 0, [stts.length, ...stts.flat()])];
	if (track.offsets.some((o) => o !== 0)) {
		const ctts = runsOf(track.offsets);
		parts.push(fullBox('ctts', track.offsets.some((o) => o < 0) ? 1 : 0, [ctts.length, ...ctts.flat()]));
	}
	if (track.video && track.syncs.length < track.sizes.length) parts.push(fullBox('stss', 0, [track.syncs.length, ...track.syncs]));
	// Samples per chunk, where it changes.
	const stsc: number[] = [];
	track.runs.forEach((run, i) => {
		if (i === 0 || track.runs[i - 1].count !== run.count) stsc.push(i + 1, run.count, 1);
	});
	parts.push(fullBox('stsc', 0, [stsc.length / 3, ...stsc]));
	parts.push(fullBox('stsz', 0, [0, track.sizes.length, ...track.sizes]));
	if (wide) {
		const body = new Uint8Array(4 + chunkOffsets.length * 8);
		const view = new DataView(body.buffer);
		view.setUint32(0, chunkOffsets.length);
		chunkOffsets.forEach((o, i) => view.setBigUint64(4 + i * 8, BigInt(o)));
		parts.push(box('co64', new Uint8Array(4), body));
	} else parts.push(fullBox('stco', 0, [chunkOffsets.length, ...chunkOffsets]));
	return box('stbl', ...parts);
}

/** Sets a duration field (32 or 64 bits by the box's version) in place. */
function setDuration(b: Uint8Array, at: number, wide: boolean, value: number) {
	const view = new DataView(b.buffer, b.byteOffset);
	if (wide) view.setBigUint64(at, BigInt(Math.round(value)));
	else view.setUint32(at, Math.min(0xffffffff, Math.round(value)));
}

/** A track's trak with its new number, durations and sample tables. */
function finishedTrak(track: Track, movieScale: number, chunkOffsets: number[], wide: boolean): Uint8Array {
	const t = track.trak;
	const total = track.durations.reduce((s, d) => s + d, 0);
	const inMovie = (total / track.timescale) * movieScale;
	const parts: Uint8Array[] = [];
	for (const child of inside(t, { type: 'trak', start: 0, size: t.length, header: 8 })) {
		const bytes = bytesOf(t, child).slice();
		if (child.type === 'tkhd') {
			const v = bytes[8];
			new DataView(bytes.buffer).setUint32(8 + 4 + (v === 1 ? 16 : 8), track.id);
			setDuration(bytes, 8 + 4 + (v === 1 ? 16 : 8) + 8, v === 1, inMovie);
			parts.push(bytes);
		} else if (child.type === 'edts') {
			// An edit with no length (a fragmented file's "all of it") gets the track's length.
			const elst = boxesIn(bytes, 8).find((x) => x.type === 'elst');
			if (elst) {
				const v = bytes[elst.start + 8];
				const count = u32(bytes, elst.start + 12);
				const each = v === 1 ? 20 : 12;
				for (let i = 0; i < count; i++) {
					const at = elst.start + 16 + i * each;
					const length = v === 1 ? u64(bytes, at) : u32(bytes, at);
					if (length === 0) setDuration(bytes, at, v === 1, inMovie);
				}
			}
			parts.push(bytes);
		} else if (child.type === 'mdia') parts.push(finishedMdia(bytes, track, total, chunkOffsets, wide));
		else parts.push(bytes);
	}
	return box('trak', ...parts.map((p) => p));
}

function finishedMdia(mdia: Uint8Array, track: Track, total: number, chunkOffsets: number[], wide: boolean): Uint8Array {
	const parts: Uint8Array[] = [];
	for (const child of boxesIn(mdia, 8)) {
		const bytes = bytesOf(mdia, child).slice();
		if (child.type === 'mdhd') {
			const v = bytes[8];
			setDuration(bytes, 8 + 4 + (v === 1 ? 16 : 8) + 4, v === 1, total);
			parts.push(bytes);
		} else if (child.type === 'minf') {
			const minf: Uint8Array[] = [];
			for (const m of boxesIn(bytes, 8)) {
				if (m.type !== 'stbl') minf.push(bytesOf(bytes, m));
				else {
					const stsd = boxesIn(bytes, m.start + 8, m.start + m.size).find((x) => x.type === 'stsd')!;
					minf.push(sampleTable(track, bytesOf(bytes, stsd), chunkOffsets, wide));
				}
			}
			parts.push(box('minf', ...minf));
		} else parts.push(bytes);
	}
	return box('mdia', ...parts);
}

/**
 * Writes `series` (picture, and sound if separate) as one MP4 at `out`. Returns its size.
 */
export function flattenToMp4(series: Series[], out: string): number {
	let id = 0;
	const tracks: Track[] = [];
	let mvhd: Uint8Array | null = null;
	for (const one of series) {
		const found = tracksOf(one.init, () => ++id);
		if (!mvhd) {
			const moov = boxesIn(one.init).find((b) => b.type === 'moov')!;
			mvhd = bytesOf(one.init, childOf(one.init, moov, 'mvhd')!).slice();
		}
		readPieces(one, found);
		tracks.push(...[...found.values()].filter((t) => t.sizes.length));
	}
	if (!mvhd || !tracks.length) throw new Error('Nothing to write');

	// Every run in order of time, so picture and sound lie side by side through the file.
	const runs = tracks.flatMap((t) => t.runs).sort((a, b) => a.time - b.time);
	const dataSize = runs.reduce((s, r) => s + r.bytes, 0);

	const mv = mvhd[8];
	const movieScale = u32(mvhd, 8 + 4 + (mv === 1 ? 16 : 8));
	const longest = Math.max(...tracks.map((t) => t.durations.reduce((s, d) => s + d, 0) / t.timescale));
	setDuration(mvhd, 8 + 4 + (mv === 1 ? 16 : 8) + 4, mv === 1, longest * movieScale);
	new DataView(mvhd.buffer).setUint32(mvhd.length - 4, id + 1);

	const ftyp = box('ftyp', new TextEncoder().encode('isom'), new Uint8Array([0, 0, 2, 0]), new TextEncoder().encode('isomiso2avc1mp41'));
	const moovWith = (offsets: Map<Track, number[]>, wide: boolean) =>
		box('moov', mvhd!, ...tracks.map((t) => finishedTrak(t, movieScale, offsets.get(t) ?? [], wide)));
	const offsetsFrom = (start: number) => {
		const map = new Map<Track, number[]>(tracks.map((t) => [t, []]));
		let at = start;
		for (const run of runs) {
			map.get(run.track)!.push(at);
			at += run.bytes;
		}
		return map;
	};
	// The tables' size doesn't depend on the numbers in them: measured once, then written for real.
	const wide = ftyp.length + dataSize + 16 + moovWith(offsetsFrom(0), true).length > 0xffffffff;
	const moovSize = moovWith(offsetsFrom(0), wide).length;
	const dataStart = ftyp.length + moovSize + 16;
	const moov = moovWith(offsetsFrom(dataStart), wide);

	const fd = openSync(out, 'w');
	try {
		writeSync(fd, ftyp);
		writeSync(fd, moov);
		const mdatHead = new Uint8Array(16);
		const view = new DataView(mdatHead.buffer);
		view.setUint32(0, 1);
		mdatHead.set(new TextEncoder().encode('mdat'), 4);
		view.setBigUint64(8, BigInt(16 + dataSize));
		writeSync(fd, mdatHead);
		// Pass two: the samples, run by run, read from where each lies in its piece.
		const open = new Map<string, number>();
		try {
			for (const run of runs) {
				let source = open.get(run.piece);
				if (source === undefined) {
					// Picture and sound take turns, so a few pieces are kept open, not hundreds.
					if (open.size >= 8) {
						const [oldest, fdOld] = open.entries().next().value!;
						closeSync(fdOld);
						open.delete(oldest);
					}
					source = openSync(run.piece, 'r');
					open.set(run.piece, source);
				}
				const bytes = Buffer.alloc(run.bytes);
				readSync(source, bytes, 0, run.bytes, run.at);
				writeSync(fd, bytes);
			}
		} finally {
			for (const source of open.values()) closeSync(source);
		}
	} finally {
		closeSync(fd);
	}
	return dataStart + dataSize;
}
