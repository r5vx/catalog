/**
 * The sound of fragmented-MP4 video pieces, as a plain AAC stream (ADTS) the browser can decode
 * on its own.
 *
 * Auto-timing and the Skip Intro finder hear the pieces the player downloads (hls.js hands each
 * one to the browser: 7Movies' pieces have picture and sound together, Movy's and Aniwave's come
 * out of hls.js as sound alone). They used to decode format piece + piece with `decodeAudioData`.
 * That worked on the computer, but on the Fire TV auto-timing never moved the subtitles for
 * 7Movies or Movy (2026-10-24): its browser engine doesn't decode MP4 fragments that way, and a
 * 7Movies piece is up to 25 MB of picture to wade through for a few hundred KB of sound.
 *
 * So the boxes are read here: the sound track and its AAC settings from the format piece
 * (moov → trak → mdia → minf → stbl → stsd → mp4a → esds), and each fragment's sound samples
 * (moof → traf → tfhd/trun, data in mdat). Each sample gets the 7-byte ADTS header that plain
 * .aac files have. The result is small (sound only) and decodes everywhere AAC does.
 */

type Box = { type: string; start: number; body: number; end: number };

function* boxes(data: Uint8Array, from = 0, to = data.length): Generator<Box> {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	let at = from;
	while (at + 8 <= to) {
		let size = view.getUint32(at);
		const type = String.fromCharCode(data[at + 4], data[at + 5], data[at + 6], data[at + 7]);
		let body = at + 8;
		if (size === 1) {
			if (at + 16 > to) return;
			size = Number(view.getBigUint64(at + 8));
			body = at + 16;
		} else if (size === 0) {
			size = to - at;
		}
		if (size < 8 || at + size > to) return;
		yield { type, start: at, body, end: at + size };
		at += size;
	}
}

const child = (data: Uint8Array, box: Box, type: string, skip = 0) => {
	for (const b of boxes(data, box.body + skip, box.end)) if (b.type === type) return b;
	return null;
};
const children = (data: Uint8Array, box: Box, type: string) => [...boxes(data, box.body, box.end)].filter((b) => b.type === type);

/** The sound track's id and AAC settings, from a format piece. */
export type AacTrack = { id: number; profile: number; rateIndex: number; channels: number };

const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** The first AAC sound track in a format piece (init segment), or null. */
export function aacTrackOf(init: Uint8Array): AacTrack | null {
	const view = new DataView(init.buffer, init.byteOffset, init.byteLength);
	const moov = [...boxes(init)].find((b) => b.type === 'moov');
	if (!moov) return null;
	for (const trak of children(init, moov, 'trak')) {
		const tkhd = child(init, trak, 'tkhd');
		const mdia = child(init, trak, 'mdia');
		const hdlr = mdia && child(init, mdia, 'hdlr');
		if (!tkhd || !mdia || !hdlr) continue;
		// hdlr: version/flags, pre_defined, then the handler type.
		const handler = String.fromCharCode(...init.subarray(hdlr.body + 8, hdlr.body + 12));
		if (handler !== 'soun') continue;
		const id = view.getUint32(tkhd.body + (init[tkhd.body] === 1 ? 20 : 12));
		const minf = child(init, mdia, 'minf');
		const stbl = minf && child(init, minf, 'stbl');
		const stsd = stbl && child(init, stbl, 'stsd');
		// stsd: version/flags and an entry count, then the entries; mp4a's own fields are 28 bytes.
		const mp4a = stsd && child(init, stsd, 'mp4a', 8);
		const esds = mp4a && child(init, mp4a, 'esds', 28);
		if (!esds) continue;
		const config = audioConfig(init, esds.body + 4, esds.end);
		if (config) return { id, ...config };
	}
	return null;
}

/** The AudioSpecificConfig inside an esds's descriptors (ES → DecoderConfig → DecoderSpecificInfo). */
function audioConfig(data: Uint8Array, from: number, to: number): Omit<AacTrack, 'id'> | null {
	let at = from;
	const length = () => {
		let n = 0;
		for (let i = 0; i < 4 && at < to; i++) {
			const b = data[at++];
			n = (n << 7) | (b & 0x7f);
			if (!(b & 0x80)) break;
		}
		return n;
	};
	while (at < to) {
		const tag = data[at++];
		const size = length();
		if (tag === 0x03) {
			// ES_ID, then flags saying what optional fields follow.
			const flags = data[at + 2];
			at += 3;
			if (flags & 0x80) at += 2;
			if (flags & 0x40) at += 1 + data[at];
			if (flags & 0x20) at += 2;
		} else if (tag === 0x04) {
			// Only AAC (object type 0x40, or the MPEG-2 AAC ones).
			if (![0x40, 0x66, 0x67, 0x68].includes(data[at])) return null;
			at += 13;
		} else if (tag === 0x05) {
			const bits = (data[at] << 8) | data[at + 1];
			let profile = bits >> 11;
			const rateIndex = (bits >> 7) & 0x0f;
			const channels = (bits >> 3) & 0x0f;
			if (rateIndex > 12 || channels === 0 || channels > 7) return null;
			// HE-AAC (SBR/PS) is sent as its AAC-LC core; decoders find the rest themselves.
			if (profile === 5 || profile === 29) profile = 2;
			if (profile < 1 || profile > 4) return null;
			return { profile, rateIndex, channels };
		} else {
			at += size;
		}
	}
	return null;
}

/**
 * The track's sound samples in one fragment piece (one or more moof + mdat), each with an ADTS
 * header, or null when it can't be read this way.
 */
export function adtsOf(track: AacTrack, piece: Uint8Array): Uint8Array | null {
	const view = new DataView(piece.buffer, piece.byteOffset, piece.byteLength);
	const frames: Uint8Array[] = [];
	let total = 0;
	for (const moof of boxes(piece)) {
		if (moof.type !== 'moof') continue;
		for (const traf of children(piece, moof, 'traf')) {
			const tfhd = child(piece, traf, 'tfhd');
			if (!tfhd || view.getUint32(tfhd.body + 4) !== track.id) continue;
			const tfFlags = view.getUint32(tfhd.body) & 0xffffff;
			let p = tfhd.body + 8;
			// A base offset counts from the start of a whole file, which a piece isn't.
			if (tfFlags & 0x01) return null;
			if (tfFlags & 0x02) p += 4;
			if (tfFlags & 0x08) p += 4;
			const defaultSize = tfFlags & 0x10 ? view.getUint32(p) : 0;
			let dataAt = moof.start;
			for (const trun of children(piece, traf, 'trun')) {
				const flags = view.getUint32(trun.body) & 0xffffff;
				const count = view.getUint32(trun.body + 4);
				let q = trun.body + 8;
				if (flags & 0x01) {
					dataAt = moof.start + view.getInt32(q);
					q += 4;
				}
				if (flags & 0x04) q += 4;
				for (let i = 0; i < count; i++) {
					if (flags & 0x100) q += 4;
					const size = flags & 0x200 ? view.getUint32(q) : defaultSize;
					if (flags & 0x200) q += 4;
					if (flags & 0x400) q += 4;
					if (flags & 0x800) q += 4;
					if (!size || dataAt + size > piece.length) return null;
					frames.push(header(track, size), piece.subarray(dataAt, dataAt + size));
					total += 7 + size;
					dataAt += size;
				}
			}
		}
	}
	if (!frames.length) return null;
	const out = new Uint8Array(total);
	let at = 0;
	for (const f of frames) {
		out.set(f, at);
		at += f.length;
	}
	return out;
}

/** The 7-byte ADTS header of one AAC frame of `size` bytes. */
function header(track: AacTrack, size: number): Uint8Array {
	const length = size + 7;
	return new Uint8Array([
		0xff,
		0xf1,
		((track.profile - 1) << 6) | (track.rateIndex << 2) | (track.channels >> 2),
		((track.channels & 3) << 6) | (length >> 11),
		(length >> 3) & 0xff,
		((length & 7) << 5) | 0x1f,
		0xfc
	]);
}

/** The sample rate an ADTS stream from this track plays at. */
export const rateOf = (track: AacTrack) => RATES[track.rateIndex];
