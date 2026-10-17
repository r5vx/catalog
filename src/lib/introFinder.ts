/**
 * Finding a show's opening and closing songs from the sound alone, the way Plex and Jellyfin
 * do it: two episodes of the same season play the same song for a minute or more, so the longest
 * stretch of sound the two have in common near the start is the intro, and near the end the
 * credits. Used when AniSkip (crowd-sourced) has nothing for an episode, or has times for a copy
 * of a different length.
 *
 * The sound is turned into a fingerprint: every 0.128 s, which of 32 frequency bands got louder
 * or quieter than their neighbour compared with a moment before (one bit each). That survives
 * volume, compression and slight differences between copies, and two stretches of the same song
 * give nearly the same bits.
 */

export const RATE = 8000; // samples a second the fingerprint is made from
const SIZE = 2048; // samples looked at each time (0.256 s)
const HOP = 1024; // a fingerprint every 0.128 s
export const STEP = HOP / RATE;
const BANDS = 33; // 32 differences between neighbouring bands
const LOW = 300; // Hz
const HIGH = 3000;

/** One 32-bit fingerprint per 0.128 s of `samples` (mono, 8 kHz). */
export function fingerprint(samples: Float32Array): Uint32Array {
	const count = Math.max(0, Math.floor((samples.length - SIZE) / HOP) + 1);
	const prints = new Uint32Array(count);
	const window = new Float32Array(SIZE);
	for (let i = 0; i < SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SIZE - 1));
	// Which FFT bins make up each band (spaced evenly in pitch, as hearing is).
	const edges: number[] = [];
	for (let b = 0; b <= BANDS; b++) {
		const hz = LOW * Math.pow(HIGH / LOW, b / BANDS);
		edges.push(Math.round((hz / RATE) * SIZE));
	}
	const re = new Float32Array(SIZE);
	const im = new Float32Array(SIZE);
	let previous = new Float32Array(BANDS);
	const energy = new Float32Array(BANDS);
	for (let n = 0; n < count; n++) {
		const at = n * HOP;
		for (let i = 0; i < SIZE; i++) {
			re[i] = samples[at + i] * window[i];
			im[i] = 0;
		}
		fft(re, im);
		for (let b = 0; b < BANDS; b++) {
			let sum = 0;
			for (let k = edges[b]; k < Math.max(edges[b] + 1, edges[b + 1]); k++) sum += re[k] * re[k] + im[k] * im[k];
			energy[b] = sum;
		}
		let bits = 0;
		for (let b = 0; b < BANDS - 1; b++) {
			const now = energy[b] - energy[b + 1];
			const before = previous[b] - previous[b + 1];
			if (now - before > 0) bits |= 1 << b;
		}
		prints[n] = bits >>> 0;
		previous = Float32Array.from(energy);
	}
	return prints;
}

/** In-place radix-2 FFT (length a power of two). */
function fft(re: Float32Array, im: Float32Array): void {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]];
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const angle = (-2 * Math.PI) / len;
		const wr = Math.cos(angle);
		const wi = Math.sin(angle);
		for (let i = 0; i < n; i += len) {
			let cr = 1;
			let ci = 0;
			for (let k = 0; k < len / 2; k++) {
				const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
				const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
				re[i + k + len / 2] = re[i + k] - ar;
				im[i + k + len / 2] = im[i + k] - ai;
				re[i + k] += ar;
				im[i + k] += ai;
				const next = cr * wr - ci * wi;
				ci = cr * wi + ci * wr;
				cr = next;
			}
		}
	}
}

function differentBits(x: number): number {
	x = x - ((x >>> 1) & 0x55555555);
	x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
	return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

const SAME = 10; // fingerprints this close (bits out of 32) are the same sound
const GAP = Math.round(1.5 / STEP); // a run survives this many unlike fingerprints in a row

/** Where the same sound plays in both: seconds into `a` and into `b`, and how long. */
export type Shared = { a: number; b: number; length: number };

/**
 * The longest stretch of the same sound in two fingerprints, at least `minimum` seconds long.
 * Every way of lining the two up is tried; for each, the longest run of matching fingerprints
 * (short dropouts allowed) is found.
 */
export function longestShared(a: Uint32Array, b: Uint32Array, minimum: number): Shared | null {
	let best: Shared | null = null;
	let bestLength = Math.round(minimum / STEP) - 1;
	for (let offset = -(b.length - 1); offset < a.length; offset++) {
		const from = Math.max(0, offset);
		const to = Math.min(a.length, b.length + offset);
		if (to - from <= bestLength) continue;
		let runStart = -1;
		let lastMatch = -1;
		for (let i = from; i < to; i++) {
			if (differentBits(a[i] ^ b[i - offset]) > SAME) {
				if (runStart >= 0 && i - lastMatch > GAP) {
					if (lastMatch - runStart + 1 > bestLength) {
						bestLength = lastMatch - runStart + 1;
						best = { a: runStart * STEP, b: (runStart - offset) * STEP, length: bestLength * STEP };
					}
					runStart = -1;
				}
				continue;
			}
			if (runStart < 0) runStart = i;
			lastMatch = i;
		}
		if (runStart >= 0 && lastMatch - runStart + 1 > bestLength) {
			bestLength = lastMatch - runStart + 1;
			best = { a: runStart * STEP, b: (runStart - offset) * STEP, length: bestLength * STEP };
		}
	}
	return best;
}
