/**
 * Live TV's video pieces come disguised as pictures (sources/daddylive.ts, 2026-10-24): each is a
 * real PNG on TikTok's servers, and its pixels, once decoded, spell "TIKTIKPX", a 4-byte length,
 * then a gzip file holding 6 seconds of MPEG-TS video. The site's own player unwraps them; the
 * relay does it here, so every player (computer, phone, TV) gets plain video.
 *
 * PNG decoding, as the format describes it: the IDAT chunks joined and inflated, then each row
 * un-filtered (None, Sub, Up, Average, Paeth) against the row above.
 *
 * Soccer replays (sources/replays.ts, soccerfull) hide theirs more simply: a 1×1 picture, and the
 * MPEG-TS video straight after its end (IEND).
 */
import { gunzipSync, inflateSync } from 'node:zlib';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MARK = Buffer.from('TIKTIKPX');
/** Bytes per pixel for each 8-bit colour type (grey, RGB, grey+alpha, RGBA). */
const BYTES: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

export const isPicture = (bytes: Uint8Array) => bytes.length > 8 && PNG.equals(Buffer.from(bytes.subarray(0, 8)));

/** The video inside a disguised picture, or null if it isn't one. */
export function videoFromPicture(picture: Buffer): Buffer | null {
	try {
		if (!isPicture(picture)) return null;
		const width = picture.readUInt32BE(16);
		const height = picture.readUInt32BE(20);
		const depth = picture[24];
		const perPixel = BYTES[picture[25]];
		if (depth !== 8 || !perPixel) return null;

		const data: Buffer[] = [];
		for (let at = 8; at + 8 <= picture.length; ) {
			const length = picture.readUInt32BE(at);
			const type = picture.toString('latin1', at + 4, at + 8);
			if (type === 'IDAT') data.push(picture.subarray(at + 8, at + 8 + length));
			if (type === 'IEND') {
				// Video after the picture's end: that's the video (MPEG-TS starts with 0x47 every 188 bytes).
				const after = at + 12 + length;
				if (picture.length > after + 376 && picture[after] === 0x47 && picture[after + 188] === 0x47) return picture.subarray(after);
				break;
			}
			at += 12 + length;
		}
		const raw = inflateSync(Buffer.concat(data));
		const stride = width * perPixel;
		const pixels = Buffer.alloc(height * stride);
		for (let y = 0; y < height; y++) {
			const filter = raw[y * (stride + 1)];
			const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
			const at = y * stride;
			for (let x = 0; x < stride; x++) {
				const left = x >= perPixel ? pixels[at + x - perPixel] : 0;
				const up = y ? pixels[at - stride + x] : 0;
				const upLeft = y && x >= perPixel ? pixels[at - stride + x - perPixel] : 0;
				let value = row[x];
				if (filter === 1) value += left;
				else if (filter === 2) value += up;
				else if (filter === 3) value += (left + up) >> 1;
				else if (filter === 4) {
					const guess = left + up - upLeft;
					const toLeft = Math.abs(guess - left);
					const toUp = Math.abs(guess - up);
					const toUpLeft = Math.abs(guess - upLeft);
					value += toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft;
				}
				pixels[at + x] = value & 255;
			}
		}
		if (!MARK.equals(pixels.subarray(0, 8))) return null;
		const size = pixels.readUInt32BE(8);
		return gunzipSync(pixels.subarray(12, 12 + size));
	} catch {
		return null;
	}
}
