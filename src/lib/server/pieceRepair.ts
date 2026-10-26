/**
 * Mends 7Movies' HEVC (Orion) pieces, whose picture otherwise stops for 2–3 s now and then while
 * the sound and subtitles go on (a friend's Hurt Locker, SVU S28E3; 2026-10-25).
 *
 * In most of their pieces (1,148 of Hurt Locker's 1,567), one of the first few frames carries the
 * keyframe's own display time, and a slot a few frames later is left empty. The browser lets
 * the later frame replace the keyframe — not always, but 11 times over Hurt Locker — and without
 * its keyframe it throws away everything up to the next one: a 2.4 s hole in the picture, which
 * hls.js asks for again and again ("bufferAppendNoProgress").
 *
 * It's the keyframe whose time is wrong. It's a CRA picture, and the frames right after it are
 * "leading" ones (RASL) that are shown before it: the picture numbers inside the video (POC)
 * say so, and put the keyframe in the empty slot, in all 73 faulty pieces of SVU S28E3 checked.
 * So the keyframe is moved into the slot: its composition offset in the piece's index
 * (moof → traf → trun) is rewritten in place, nothing else changes. (Until 2026-10-25 night the
 * other frame was moved instead; that stopped the holes but showed two frames out of order every
 * piece, a visible stutter every 6 s.)
 *
 * Anything that isn't an fMP4 piece with per-frame offsets, or doesn't match that pattern
 * exactly, is left as it came.
 */

const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const i32 = (b: Uint8Array, at: number) => u32(b, at) | 0;
const type = (b: Uint8Array, at: number) => String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7]);
function put32(b: Uint8Array, at: number, value: number) {
	b[at] = (value >>> 24) & 0xff;
	b[at + 1] = (value >>> 16) & 0xff;
	b[at + 2] = (value >>> 8) & 0xff;
	b[at + 3] = value & 0xff;
}

/** The piece with its frame times mended (a copy), or the piece itself when nothing needs it. */
export function repairFrameTimes(piece: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
	try {
		let out: Uint8Array<ArrayBuffer> | null = null;
		for (let at = 0; at + 8 <= piece.length; ) {
			const size = u32(piece, at);
			if (size < 8 || at + size > piece.length) break;
			if (type(piece, at) === 'moof') {
				const fixes = trafFixes(piece, at + 8, at + size);
				if (fixes.length) {
					out ??= piece.slice();
					for (const { offset, value } of fixes) put32(out, offset, value);
				}
			}
			if (type(piece, at) === 'mdat') break;
			at += size;
		}
		return out ?? piece;
	} catch {
		return piece;
	}
}

/** The composition offsets to rewrite in one moof's track fragments: where, and to what. */
function trafFixes(b: Uint8Array, from: number, to: number): { offset: number; value: number }[] {
	const fixes: { offset: number; value: number }[] = [];
	for (let at = from; at + 8 <= to; ) {
		const size = u32(b, at);
		if (size < 8) break;
		if (type(b, at) === 'traf') fixes.push(...trunFixes(b, at + 8, at + size));
		at += size;
	}
	return fixes;
}

function trunFixes(b: Uint8Array, from: number, to: number): { offset: number; value: number }[] {
	let defaultDuration = 0;
	let defaultFlags = 0;
	for (let at = from; at + 8 <= to; ) {
		const size = u32(b, at);
		if (size < 8) break;
		const box = type(b, at);
		if (box === 'tfhd') {
			const flags = u32(b, at + 8) & 0xffffff;
			let p = at + 16;
			if (flags & 0x1) p += 8;
			if (flags & 0x2) p += 4;
			if (flags & 0x8) {
				defaultDuration = u32(b, p);
				p += 4;
			}
			if (flags & 0x10) p += 4;
			if (flags & 0x20) defaultFlags = u32(b, p);
		}
		if (box === 'trun') {
			const versionFlags = u32(b, at + 8);
			const version = versionFlags >>> 24;
			const flags = versionFlags & 0xffffff;
			// Only with an offset per frame (that's what's wrong), and a whole index.
			if (!(flags & 0x800)) return [];
			const count = u32(b, at + 12);
			let p = at + 16;
			if (flags & 0x1) p += 4;
			let firstFlags: number | null = null;
			if (flags & 0x4) {
				firstFlags = u32(b, p);
				p += 4;
			}
			const frames: { dts: number; pts: number; sync: boolean; ctoAt: number }[] = [];
			let dts = 0;
			for (let i = 0; i < count; i++) {
				if (p > at + size) return [];
				let duration = defaultDuration;
				if (flags & 0x100) {
					duration = u32(b, p);
					p += 4;
				}
				if (flags & 0x200) p += 4;
				let sampleFlags = i === 0 && firstFlags !== null ? firstFlags : defaultFlags;
				if (flags & 0x400) {
					sampleFlags = u32(b, p);
					p += 4;
				}
				const cto = version === 0 ? u32(b, p) : i32(b, p);
				frames.push({ dts, pts: dts + cto, sync: !((sampleFlags >>> 16) & 1), ctoAt: p });
				p += 4;
				dts += duration;
			}
			return mend(frames, defaultDuration, version);
		}
		at += size;
	}
	return [];
}

/** One frame on the keyframe's time and one empty slot after it: the keyframe goes into the slot. */
function mend(frames: { dts: number; pts: number; sync: boolean; ctoAt: number }[], step: number, version: number) {
	if (frames.length < 3 || step <= 0) return [];
	const key = frames.findIndex((f) => f.sync);
	if (key < 0) return [];
	const clashes = frames.filter((f, i) => i !== key && !f.sync && f.pts === frames[key].pts);
	if (clashes.length !== 1) return [];
	// The frame times should step evenly from the earliest to the latest; the one missing is the slot.
	const times = new Set(frames.map((f) => f.pts));
	const low = Math.min(...times);
	const high = Math.max(...times);
	if ((high - low) % step !== 0) return [];
	const missing: number[] = [];
	for (let t = low; t <= high; t += step) if (!times.has(t)) missing.push(t);
	if (missing.length !== 1 || missing[0] < frames[key].pts) return [];
	const value = missing[0] - frames[key].dts;
	if (version === 0 && value < 0) return [];
	return [{ offset: frames[key].ctoAt, value: value >>> 0 }];
}
