/**
 * The fingerprinting and matching of skipFinder.ts, off the page so the video never stutters.
 * In: { heads: [a, b], tails: [a, b] } (8 kHz mono sound from the start and the end of two
 * episodes). Out: { intro, credits } — each a Shared (seconds into each piece) or null.
 */
import { fingerprint, longestShared } from './introFinder';

self.onmessage = (event: MessageEvent) => {
	const { heads, tails } = event.data as { heads: [Float32Array, Float32Array]; tails: [Float32Array, Float32Array] };
	const intro = longestShared(fingerprint(heads[0]), fingerprint(heads[1]), 20);
	const credits = longestShared(fingerprint(tails[0]), fingerprint(tails[1]), 20);
	self.postMessage({ intro, credits });
};
