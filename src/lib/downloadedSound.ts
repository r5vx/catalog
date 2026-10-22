/**
 * The sound of the video being watched, taken from what the player downloads anyway (each piece
 * hls.js hands the browser, `add`), for finding the intro and credits of a copy with no separate
 * sound track (skipFinder.ts): 7Movies' H.264 copy, Movy, Aniwave. Only the first 6 and the last
 * 5 minutes are kept, decoded at the fingerprint's 8 kHz (about 12 MB at most); nothing else is
 * kept or fetched.
 */
import { RATE } from './introFinder';
import { HEAD, TAIL } from './skipFinder';

type Chunk = { at: number; length: number; samples: Float32Array };

export class DownloadedSound {
	private init: Uint8Array | null = null;
	private chunks: Chunk[] = [];
	private queue: { at: number; length: number; data: Uint8Array }[] = [];
	private busy = false;
	private listeners = new Set<() => void>();

	/** `durationOf`: the video's length once known (NaN before). */
	constructor(private readonly durationOf: () => number) {}

	/** A piece the player just handed the browser (`isInit`: the format piece, which comes first). */
	add(data: Uint8Array, at: number, length: number, isInit: boolean): void {
		if (isInit) {
			this.init = data.slice();
			return;
		}
		const duration = this.durationOf();
		const nearEnd = Number.isFinite(duration) && duration > 0 && at + length > duration - TAIL - 2;
		if (at >= HEAD && !nearEnd) return;
		if (this.chunks.some((c) => Math.abs(c.at - at) < 0.05) || this.queue.some((q) => Math.abs(q.at - at) < 0.05)) return;
		this.queue.push({ at, length, data: data.slice() });
		void this.decode();
	}

	/** One piece at a time, with the format piece in front, decoded by the browser and made mono. */
	private async decode(): Promise<void> {
		if (this.busy || !this.init) return;
		this.busy = true;
		try {
			while (this.queue.length && this.init) {
				const piece = this.queue.shift()!;
				const bytes = new Uint8Array(this.init.length + piece.data.length);
				bytes.set(this.init);
				bytes.set(piece.data, this.init.length);
				try {
					const sound = await new OfflineAudioContext(1, RATE, RATE).decodeAudioData(bytes.buffer);
					const mono = new Float32Array(sound.length);
					for (let c = 0; c < sound.numberOfChannels; c++) {
						const channel = sound.getChannelData(c);
						for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / sound.numberOfChannels;
					}
					this.chunks.push({ at: piece.at, length: sound.duration, samples: mono });
					for (const listener of this.listeners) listener();
				} catch {
					// A piece the browser can't decode on its own: skipped.
				}
			}
		} finally {
			this.busy = false;
		}
	}

	/** The sound from `from` to `to` seconds if every part of it has been heard, else null. */
	between(from: number, to: number): { at: number; samples: Float32Array } | null {
		const sorted = [...this.chunks].sort((a, b) => a.at - b.at);
		let reached = from;
		for (const c of sorted) {
			if (c.at > reached + 0.5) break;
			reached = Math.max(reached, c.at + c.length);
			if (reached >= to - 0.5) break;
		}
		if (reached < to - 0.5) return null;
		const samples = new Float32Array(Math.round((to - from) * RATE));
		for (const c of sorted) {
			const offset = Math.round((c.at - from) * RATE);
			const start = Math.max(0, -offset);
			const end = Math.min(c.samples.length, samples.length - offset);
			if (end > start) samples.set(c.samples.subarray(start, end), offset + start);
		}
		return { at: from, samples };
	}

	/**
	 * The longest unbroken stretch heard within `from`–`to` (the start of the video, or its end),
	 * as sound; null if none yet.
	 */
	longestWithin(from: number, to: number): { at: number; samples: Float32Array } | null {
		const sorted = this.chunks.filter((c) => c.at + c.length > from && c.at < to).sort((a, b) => a.at - b.at);
		let best: [number, number] | null = null;
		let start = -1;
		let end = -1;
		for (const c of sorted) {
			if (start < 0 || c.at > end + 0.5) {
				start = c.at;
				end = c.at + c.length;
			} else end = Math.max(end, c.at + c.length);
			if (!best || end - start > best[1] - best[0]) best = [start, end];
		}
		if (!best) return null;
		return this.between(Math.max(from, best[0]), Math.min(to, best[1]));
	}

	/** Told each time more has been heard; returns how to stop being told. */
	onHeard(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** The video's length, once it's known. */
	async duration(signal: AbortSignal): Promise<number> {
		while (!signal.aborted) {
			const d = this.durationOf();
			if (Number.isFinite(d) && d > 0) return d;
			await new Promise((r) => setTimeout(r, 1000));
		}
		return 0;
	}
}
