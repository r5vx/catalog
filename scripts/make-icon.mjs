/**
 * Draws the app icon: a flat circle, no dependencies.
 *
 * Change PINK and re-run `npm run icon` to restyle it.
 *
 * The important part is the .ico. Windows shows the taskbar icon at about 24px,
 * and shrinking one big image down to that size is what makes edges look
 * chewed. So every size is drawn from scratch at its own resolution, with
 * enough supersampling that the curve stays smooth even at 16px.
 */
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PINK = '#E994C2';

/** Sizes Windows picks from. Small ones matter most — that's the taskbar. */
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function hexToRgb(hex) {
	const value = Number.parseInt(hex.replace('#', ''), 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function pngChunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);

	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(body) >>> 0);

	return Buffer.concat([length, body, checksum]);
}

/**
 * One circle, drawn at exactly `size` pixels.
 *
 * Samples 8x8 points per pixel, so an edge pixel gets one of 65 coverage
 * levels rather than a hard in/out decision. That is what removes the stair
 * stepping at small sizes.
 */
function drawCircle(size, [r, g, b]) {
	const centre = size / 2;
	// A hair of padding so the antialiased rim isn't clipped by the canvas.
	const radius = centre - Math.max(0.5, size * 0.015);
	const raw = Buffer.alloc(size * (1 + size * 4));

	const SAMPLES = 8;
	const step = 1 / SAMPLES;
	const total = SAMPLES * SAMPLES;

	let offset = 0;
	for (let y = 0; y < size; y++) {
		raw[offset++] = 0; // filter: none

		for (let x = 0; x < size; x++) {
			let inside = 0;

			for (let sy = 0; sy < SAMPLES; sy++) {
				for (let sx = 0; sx < SAMPLES; sx++) {
					const px = x + (sx + 0.5) * step - centre;
					const py = y + (sy + 0.5) * step - centre;
					if (px * px + py * py <= radius * radius) inside++;
				}
			}

			raw[offset++] = r;
			raw[offset++] = g;
			raw[offset++] = b;
			raw[offset++] = Math.round((inside / total) * 255);
		}
	}

	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0);
	header.writeUInt32BE(size, 4);
	header[8] = 8; // bit depth
	header[9] = 6; // colour type: RGBA
	header[10] = 0;
	header[11] = 0;
	header[12] = 0;

	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk('IHDR', header),
		pngChunk('IDAT', deflateSync(raw, { level: 9 })),
		pngChunk('IEND', Buffer.alloc(0))
	]);
}

/**
 * Bundle the PNGs into one .ico. Windows reads PNG-compressed entries directly,
 * so each size goes in exactly as drawn.
 */
function buildIco(images) {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // 1 = icon
	header.writeUInt16LE(images.length, 4);

	const directory = Buffer.alloc(16 * images.length);
	let offset = header.length + directory.length;

	images.forEach((image, index) => {
		const at = index * 16;
		// 256 is stored as 0 — the field is a single byte.
		directory[at + 0] = image.size >= 256 ? 0 : image.size;
		directory[at + 1] = image.size >= 256 ? 0 : image.size;
		directory[at + 2] = 0; // palette colours
		directory[at + 3] = 0; // reserved
		directory.writeUInt16LE(1, at + 4); // colour planes
		directory.writeUInt16LE(32, at + 6); // bits per pixel
		directory.writeUInt32LE(image.data.length, at + 8);
		directory.writeUInt32LE(offset, at + 12);
		offset += image.data.length;
	});

	return Buffer.concat([header, directory, ...images.map((i) => i.data)]);
}

const rgb = hexToRgb(PINK);

mkdirSync(join(root, 'assets'), { recursive: true });
mkdirSync(join(root, 'static'), { recursive: true });

// Each of these is drawn at its own size, never resized.
const full = drawCircle(512, rgb);

writeFileSync(join(root, 'assets', 'icon.png'), full);
writeFileSync(join(root, 'static', 'icon.png'), full);
writeFileSync(join(root, 'static', 'icon-512.png'), full);
writeFileSync(join(root, 'static', 'icon-192.png'), drawCircle(192, rgb));
writeFileSync(join(root, 'static', 'icon-180.png'), drawCircle(180, rgb));

const ico = buildIco(ICO_SIZES.map((size) => ({ size, data: drawCircle(size, rgb) })));
writeFileSync(join(root, 'assets', 'icon.ico'), ico); // builds the .exe icon
writeFileSync(join(root, 'static', 'icon.ico'), ico); // the running window's icon

console.log(`Icons written in ${PINK}`);
console.log(`  icon.ico contains ${ICO_SIZES.length} sizes: ${ICO_SIZES.join(', ')}`);
console.log(`  each drawn at its own resolution, not scaled down`);
