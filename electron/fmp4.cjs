/*
 * (Used by youtubeHelper.cjs.) Reading the fragmented MP4 a player puts into a video element: the start (ftyp + moov: codec,
 * timescale) and then pieces (moof + mdat), each with its start time and length. Bytes arrive in
 * any sizes, so they're gathered per track until whole boxes are there.
 */
function boxes(buf, from = 0, to = buf.length) {
	const out = [];
	let at = from;
	while (at + 8 <= to) {
		let size = buf.readUInt32BE(at);
		const type = buf.toString('latin1', at + 4, at + 8);
		let head = 8;
		if (size === 1) {
			if (at + 16 > to) break;
			size = Number(buf.readBigUInt64BE(at + 8));
			head = 16;
		} else if (size === 0) size = to - at;
		if (size < head || at + size > to) break;
		out.push({ type, start: at, head, end: at + size });
		at += size;
	}
	return { list: out, used: at };
}

const child = (buf, box, type) => boxes(buf, box.start + box.head, box.end).list.find((b) => b.type === type);

/** From an init segment: timescale, the default sample length (trex) and the picture's height. */
function readInit(buf) {
	const moov = boxes(buf).list.find((b) => b.type === 'moov');
	if (!moov) return null;
	const trak = child(buf, moov, 'trak');
	const tkhd = trak && child(buf, trak, 'tkhd');
	const height = tkhd ? buf.readUInt32BE(tkhd.end - 4) >>> 16 : 0;
	const mdia = trak && child(buf, trak, 'mdia');
	const mdhd = mdia && child(buf, mdia, 'mdhd');
	if (!mdhd) return null;
	const v = buf[mdhd.start + 8];
	const timescale = buf.readUInt32BE(mdhd.start + 8 + (v === 1 ? 4 + 16 : 4 + 8));
	let defaultDuration = 0;
	const mvex = child(buf, moov, 'mvex');
	const trex = mvex && child(buf, mvex, 'trex');
	if (trex) defaultDuration = buf.readUInt32BE(trex.start + 8 + 4 + 4 + 4);
	return { timescale, defaultDuration, height };
}

/** A moof's start (ticks) and length (ticks). */
function readMoof(buf, moof, defaultDuration) {
	const traf = child(buf, moof, 'traf');
	if (!traf) return null;
	const tfhd = child(buf, traf, 'tfhd');
	const tfdt = child(buf, traf, 'tfdt');
	const trun = child(buf, traf, 'trun');
	if (!tfdt || !trun) return null;
	const tv = buf[tfdt.start + 8];
	const start = tv === 1 ? Number(buf.readBigUInt64BE(tfdt.start + 12)) : buf.readUInt32BE(tfdt.start + 12);
	let dflt = defaultDuration;
	if (tfhd) {
		const flags = buf.readUInt32BE(tfhd.start + 8) & 0xffffff;
		let p = tfhd.start + 16;
		if (flags & 0x01) p += 8;
		if (flags & 0x02) p += 4;
		if (flags & 0x08) dflt = buf.readUInt32BE(p);
	}
	const flags = buf.readUInt32BE(trun.start + 8) & 0xffffff;
	const count = buf.readUInt32BE(trun.start + 12);
	let p = trun.start + 16;
	if (flags & 0x01) p += 4;
	if (flags & 0x04) p += 4;
	let duration = 0;
	for (let i = 0; i < count; i++) {
		if (flags & 0x100) { duration += buf.readUInt32BE(p); p += 4; } else duration += dflt;
		if (flags & 0x200) p += 4;
		if (flags & 0x400) p += 4;
		if (flags & 0x800) p += 4;
	}
	return { start, duration };
}

/**
 * One track's bytes as they come: `push(bytes)` gives back what became whole — an init segment
 * ({ init: Buffer, timescale }) or a piece ({ piece: Buffer, start, duration } in seconds).
 */
class TrackReader {
	constructor() {
		this.rest = Buffer.alloc(0);
		this.init = null;
		this.pendingInit = [];
		this.moof = null;
	}
	reset() {
		this.rest = Buffer.alloc(0);
		this.moof = null;
	}
	push(bytes) {
		const out = [];
		this.rest = this.rest.length ? Buffer.concat([this.rest, bytes]) : bytes;
		const { list, used } = boxes(this.rest);
		for (const b of list) {
			const data = this.rest.subarray(b.start, b.end);
			if (b.type === 'ftyp') this.pendingInit = [data];
			else if (b.type === 'moov') {
				const init = Buffer.concat([...this.pendingInit, data]);
				const info = readInit(init);
				this.pendingInit = [];
				if (info) {
					this.init = { ...info, bytes: init };
					out.push({ init, timescale: info.timescale, height: info.height });
				}
			} else if (b.type === 'moof') this.moof = data;
			else if (b.type === 'mdat' && this.moof && this.init) {
				const m = readMoof(this.moof, { start: 0, head: 8, end: this.moof.length }, this.init.defaultDuration);
				if (m) out.push({ piece: Buffer.concat([this.moof, data]), start: m.start / this.init.timescale, duration: m.duration / this.init.timescale });
				this.moof = null;
			}
		}
		this.rest = Buffer.from(this.rest.subarray(used));
		return out;
	}
}

module.exports = { TrackReader, boxes, readInit };
