/**
 * Preview pictures for the Roku, as a BIF file ("Base Index Frames", Roku's own format for the
 * pictures shown while fast-forwarding and rewinding): the pictures the computer keeps for a
 * video's progress bar (previewStrips.ts), one for every 10 seconds.
 *
 * The file: a 64-byte header (the magic number, version 0, how many pictures, and the seconds
 * between them in milliseconds), then an index (each picture's time in those steps and where it
 * starts in the file, ended by 0xFFFFFFFF and the file's end), then the JPEGs one after another.
 */

const MAGIC = [0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
export const BIF_STEP = 10;

/**
 * A BIF of a video `length` seconds long from kept pictures (base64 JPEGs by second): a picture
 * every 10 s, each the kept one nearest that moment (they're taken where pieces start, which
 * varies). Null when there are too few to be any use.
 */
export function bifOf(frames: Record<string, string>, length: number): Buffer | null {
	const kept = Object.keys(frames)
		.map(Number)
		.filter((t) => Number.isFinite(t) && t >= 0 && t <= length)
		.sort((a, b) => a - b);
	if (kept.length < 10 || !(length > 0)) return null;
	const pictures: Buffer[] = [];
	let k = 0;
	for (let t = 0; t < length; t += BIF_STEP) {
		while (k + 1 < kept.length && Math.abs(kept[k + 1] - t) <= Math.abs(kept[k] - t)) k++;
		pictures.push(Buffer.from(frames[String(kept[k])], 'base64'));
	}
	const header = Buffer.alloc(64);
	Buffer.from(MAGIC).copy(header, 0);
	header.writeUInt32LE(0, 8);
	header.writeUInt32LE(pictures.length, 12);
	header.writeUInt32LE(BIF_STEP * 1000, 16);
	const index = Buffer.alloc((pictures.length + 1) * 8);
	let offset = header.length + index.length;
	pictures.forEach((picture, i) => {
		index.writeUInt32LE(i, i * 8);
		index.writeUInt32LE(offset, i * 8 + 4);
		offset += picture.length;
	});
	index.writeUInt32LE(0xffffffff, pictures.length * 8);
	index.writeUInt32LE(offset, pictures.length * 8 + 4);
	return Buffer.concat([header, index, ...pictures]);
}
