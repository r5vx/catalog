import Hls from 'hls.js';

/**
 * A strip of small pictures across a video, for the preview above the progress bar — the way
 * streaming apps do it. Gathered from an unseen copy of the video (the smallest there is): each
 * picture is the first frame of one piece of it, which streams in, gets drawn, and the rest of
 * the piece is left — a small download. A rough pass first (one a minute, so anywhere on the bar
 * soon has a picture nearby), then every `step` seconds; the one under the mouse jumps the queue.
 *
 * Pictures are kept on the computer (/api/watch/strip): what anyone gathered shows straight away
 * the next time, on any screen. Used by the player and by /strip-maker, the computer's own
 * gatherer for TVs and the next episode.
 */
/** `length`: the copy's length in seconds (pictures are kept per version: previewStrips.ts). */
export type StripVideo = { title: string; type: string; season: number; episode: number; length: number };

type Copy = { video: HTMLVideoElement; hls: Hls; ready: boolean; busy: boolean };

const WIDTH = 192;
const HEIGHT = 108;

export class PreviewStrip {
	/** Pictures by the second they show. */
	readonly frames = new Map<number, ImageBitmap>();
	/** Where each piece of the copy starts: pictures are taken there. */
	pieceStarts: number[] = [];
	/** Length of the copy, once its list of pieces is read. */
	duration = 0;
	/** The picture wanted most right now (the one under the mouse). */
	wanted: number | null = null;
	/** Told whenever a picture arrives. */
	onFrame: ((t: number) => void) | null = null;
	/** Whether the video being watched can spare the bandwidth right now. */
	canGather: () => boolean = () => true;
	/** Where the watching is, for gathering outward from there. */
	playhead: () => number = () => 0;

	private copies: Copy[] = [];
	private taking = new Set<number>();
	private fresh: number[] = [];
	private timer: ReturnType<typeof setInterval> | undefined;
	private stopped = false;

	constructor(
		private readonly url: string,
		private readonly options: { copies?: number; step?: number; max?: number } = {}
	) {}

	get step() {
		return this.options.step ?? 10;
	}

	/** How many of its copies are downloading a picture right now. */
	get busy(): number {
		return this.copies.filter((copy) => copy.busy).length;
	}

	/** Starts gathering (does nothing without hls.js support). */
	start(): void {
		if (!Hls.isSupported() || this.copies.length || this.timer) return;
		this.timer = setInterval(() => this.pump(), 1000);
		this.pictureOnly().then((source) => {
			if (this.stopped) return;
			for (let i = 0; i < (this.options.copies ?? 1); i++) this.copies.push(this.makeCopy(source));
		});
	}

	/**
	 * The smallest picture's own playlist, so the copy loads that and nothing else — with the
	 * whole list it also fetched a piece of sound for every picture, twice the downloads beside
	 * the video being watched. Relayed ones (`whole=1`) come with their pieces whole and are
	 * never fetched ahead (relayPieces.ts, relayReadAhead.ts). The whole list if it can't be read.
	 */
	private async pictureOnly(): Promise<string> {
		const relayed = this.url.startsWith('/api/watch/relay?');
		const list = relayed ? `${this.url}&whole=1` : this.url;
		try {
			const text = await (await fetch(list)).text();
			const variants = [...text.matchAll(/#EXT-X-STREAM-INF:([^\n]*)\n([^\n#][^\n]*)/g)].map((m) => ({
				bandwidth: Number(m[1].match(/BANDWIDTH=(\d+)/)?.[1] ?? Infinity),
				hevc: /hvc1|hev1/i.test(m[1]),
				uri: m[2].trim()
			}));
			const smallest = variants.filter((v) => !v.hevc).sort((a, b) => a.bandwidth - b.bandwidth)[0];
			if (!smallest) return list;
			const address = new URL(smallest.uri, new URL(list, location.href)).href;
			return address.includes('/api/watch/relay?') && !address.includes('whole=1') ? `${address}&whole=1` : address;
		} catch {
			return list;
		}
	}

	stop(): void {
		this.stopped = true;
		clearInterval(this.timer);
		for (const copy of this.copies) {
			copy.hls.destroy();
			copy.video.removeAttribute('src');
			copy.video.load();
		}
		this.copies = [];
		for (const frame of this.frames.values()) frame.close();
		this.frames.clear();
	}

	private makeCopy(source: string): Copy {
		const video = document.createElement('video');
		video.muted = true;
		video.preload = 'auto';
		const hls = new Hls({
			autoStartLoad: false,
			// Each piece streams in, so its first frame is there long before the whole piece is.
			progressive: true,
			maxBufferLength: 1,
			maxMaxBufferLength: 2,
			backBufferLength: 0,
			startLevel: 0,
			enableWorker: true
		});
		const copy: Copy = { video, hls, ready: false, busy: false };
		hls.on(Hls.Events.MANIFEST_PARSED, () => {
			// The smallest picture there is: it's only drawn small. Loading has to start for the
			// list of pieces to be read; it stops again as soon as it's there.
			hls.loadLevel = 0;
			hls.autoLevelCapping = 0;
			hls.startLoad(0);
		});
		hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => {
			if (copy.ready) return;
			copy.ready = true;
			if (!copy.busy) hls.stopLoad();
			if (!this.pieceStarts.length) {
				this.pieceStarts = data.details.fragments.map((f) => f.start);
				this.duration = data.details.totalduration;
			}
			this.pump();
		});
		hls.loadSource(source);
		hls.attachMedia(video);
		return copy;
	}

	/** The start of the piece a moment is in: where its picture is taken. */
	pieceAt(seconds: number): number {
		const starts = this.pieceStarts;
		if (!starts.length) return Math.floor(seconds);
		let lo = 0;
		let hi = starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (starts[mid] <= seconds) lo = mid;
			else hi = mid - 1;
		}
		return starts[lo];
	}

	/** The picture for a moment: its own, else the nearest within `within` seconds. */
	pictureFor(seconds: number, within = 60): ImageBitmap | null {
		let best: ImageBitmap | null = null;
		let bestOff = Infinity;
		for (const [t, frame] of this.frames) {
			const off = Math.abs(t - seconds);
			if (off < bestOff && off <= within) {
				bestOff = off;
				best = frame;
			}
		}
		return best;
	}

	/** Wants the picture for a moment next (the one under the mouse). */
	want(seconds: number): void {
		if (!this.pieceStarts.length) return;
		const piece = this.pieceAt(seconds);
		if (this.frames.has(piece)) return;
		this.wanted = piece;
		this.pump();
	}

	/** How much of the video has a picture within `step` seconds (0 to 1). */
	coverage(): number {
		if (!this.duration) return 0;
		let covered = 0;
		for (let t = 0; t < this.duration; t += this.step) if (this.pictureFor(t, this.step)) covered++;
		return covered / Math.ceil(this.duration / this.step);
	}

	/** Adds pictures kept from before (base64 JPEGs by second). */
	async addSaved(saved: Record<string, string>): Promise<void> {
		await Promise.all(
			Object.entries(saved).map(async ([t, jpeg]) => {
				try {
					const blob = await (await fetch(`data:image/jpeg;base64,${jpeg}`)).blob();
					const bitmap = await createImageBitmap(blob);
					if (this.stopped) return bitmap.close();
					this.frames.get(Number(t))?.close();
					this.frames.set(Number(t), bitmap);
				} catch {}
			})
		);
	}

	/** Pictures gathered here since last asked, as base64 JPEGs by second, for keeping. */
	async takeFresh(): Promise<Record<string, string>> {
		const times = this.fresh.splice(0);
		const out: Record<string, string> = {};
		const canvas = document.createElement('canvas');
		canvas.width = WIDTH;
		canvas.height = HEIGHT;
		const ctx = canvas.getContext('2d');
		if (!ctx) return out;
		for (const t of times) {
			const frame = this.frames.get(t);
			if (!frame) continue;
			ctx.drawImage(frame, 0, 0, WIDTH, HEIGHT);
			const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72));
			if (!blob) continue;
			const bytes = new Uint8Array(await blob.arrayBuffer());
			let binary = '';
			for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
			out[String(t)] = btoa(binary);
		}
		return out;
	}

	/** Whether there's nothing left to gather. */
	get finished(): boolean {
		return this.pieceStarts.length > 0 && this.nextTarget() === null && this.wanted === null;
	}

	/**
	 * The next picture to gather: rough pass (a minute apart) first, then the last 9 minutes every
	 * `step` (the player looks for the black credit roll in them: creditRoll.ts), then the rest.
	 */
	private nextTarget(): number | null {
		if (this.frames.size >= (this.options.max ?? 600) || !this.duration) return null;
		const passes: [number, number][] = [[60, 0], [this.step, Math.max(0, this.duration - 9 * 60)], [this.step, 0]];
		for (const [step, first] of passes) {
			const from = Math.floor(Math.max(first, this.playhead()) / step) * step;
			const order = [];
			for (let t = from; t < this.duration; t += step) order.push(t);
			for (let t = first; t < from; t += step) order.push(t);
			for (const t of order) {
				const piece = this.pieceAt(t);
				// Already has one close enough (a picture kept from another copy counts).
				if (this.taking.has(piece) || this.pictureFor(piece, Math.min(step / 2, 5))) continue;
				return piece;
			}
		}
		return null;
	}

	private pump(): void {
		if (this.stopped || !this.pieceStarts.length) return;
		for (const copy of this.copies) {
			if (!copy.ready || copy.busy) continue;
			let at: number | null = null;
			if (this.wanted !== null && !this.frames.has(this.wanted) && !this.taking.has(this.wanted)) at = this.wanted;
			else if (this.canGather()) at = this.nextTarget();
			if (at === null) return;
			if (at === this.wanted) this.wanted = null;
			this.take(copy, at);
		}
	}

	private async take(copy: Copy, at: number): Promise<void> {
		copy.busy = true;
		this.taking.add(at);
		const frame = await new Promise<ImageBitmap | null>((resolve) => {
			const done = (bitmap: ImageBitmap | null) => {
				clearTimeout(timer);
				copy.video.removeEventListener('seeked', onSeeked);
				resolve(bitmap);
			};
			const onSeeked = () => {
				createImageBitmap(copy.video, { resizeWidth: WIDTH, resizeHeight: HEIGHT }).then(done, () => done(null));
			};
			const timer = setTimeout(() => done(null), 8000);
			copy.video.addEventListener('seeked', onSeeked);
			copy.hls.startLoad(at);
			copy.video.currentTime = at + 0.05;
		});
		// The rest of that piece isn't needed.
		if (!this.stopped) copy.hls.stopLoad();
		copy.busy = false;
		this.taking.delete(at);
		if (this.stopped) {
			frame?.close();
			return;
		}
		if (frame) {
			this.frames.get(at)?.close();
			this.frames.set(at, frame);
			this.fresh.push(at);
			this.onFrame?.(at);
		}
		setTimeout(() => this.pump(), this.wanted !== null ? 0 : 150);
	}
}

/** Keeps pictures on the computer. */
export async function keepPictures(video: StripVideo, frames: Record<string, string>): Promise<void> {
	if (!Object.keys(frames).length || !(video.length > 0)) return;
	await fetch('/api/watch/strip', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...video, frames })
	}).catch(() => {});
}

/** The pictures kept for a video, as base64 JPEGs by second. */
export async function keptPictures(video: StripVideo): Promise<Record<string, string>> {
	try {
		if (!(video.length > 0)) return {};
		const params = new URLSearchParams({ title: video.title, type: video.type, season: String(video.season), episode: String(video.episode), length: String(Math.round(video.length)) });
		const response = await fetch(`/api/watch/strip?${params}`);
		return response.ok ? ((await response.json()).frames ?? {}) : {};
	} catch {
		return {};
	}
}

/**
 * Asks the computer to make a video's pictures itself (for TVs, and the next episode), from that
 * copy (`fid`, `share`). Its length can be 0 when not known yet: the computer finds it.
 */
export function askComputerForPictures(video: StripVideo & { year?: string | number | null; fid?: number; share?: string }): void {
	fetch('/api/watch/strip/prepare', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(video)
	}).catch(() => {});
}
