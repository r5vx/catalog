/**
 * Anime subtitles' signs and songs drawn as their makers styled them (libass, through JASSUB).
 *
 * Fansub and Crunchyroll .ass files do more than talk: a sign on a shop front is translated
 * where the sign is, in its colors and slant, and the opening's lyrics sing along syllable by
 * syllable. The player's own captions can only show that as plain text lines, so it didn't
 * (karaoke and drawings were dropped, signs went to the top as text).
 *
 * Now the talking stays in the player's own captions (its size, box and timing, as before) and
 * everything else in the file is drawn by libass over the video: positioned signs, songs,
 * karaoke, drawings, with the file's own fonts. Which line goes where is decided by
 * `isStyledLine` (styledLines.ts), used by the player's own reader and the server too, so a line
 * is never shown twice or not at all.
 *
 * The computer and phones only: libass is heavy for a Fire TV stick, and the Roku can't.
 */

import { dialogueLine, isStyledLine } from './styledLines';

export { isStyledLine };

/** The file with only its sign and song lines (everything else in it kept: styles, fonts). */
export function onlyStyledLines(ass: string): { content: string; count: number } {
	let count = 0;
	const kept = ass
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.filter((line) => {
			const d = dialogueLine(line);
			if (!d) return true;
			if (!isStyledLine(d.style, d.raw)) return false;
			count++;
			return true;
		});
	return { content: kept.join('\n'), count };
}

type Jassub = import('jassub').default;
type Frame = { expectedDisplayTime: number; width: number; height: number; mediaTime: number };

/**
 * libass over `video`. `subTime(t)` is the subtitle time showing at video time `t` (the player's
 * delay and speed, auto-timing's included); `fit()` is how the video fills the screen.
 */
export class StyledSubs {
	private instance: Jassub | null = null;
	private lastFrame: Frame | null = null;
	private closed = false;
	private video: HTMLVideoElement;
	private subTime: (t: number) => number;
	private fit: () => 'contain' | 'cover';

	constructor(video: HTMLVideoElement, subTime: (t: number) => number, fit: () => 'contain' | 'cover') {
		this.video = video;
		this.subTime = subTime;
		this.fit = fit;
	}

	/** Starts drawing `content` (only the styled lines: `onlyStyledLines`). */
	async show(content: string): Promise<void> {
		const [{ default: JASSUB }, workerUrl, wasmUrl, modernWasmUrl, fontUrl] = await Promise.all([
			import('jassub'),
			import('jassub/dist/worker/worker.js?worker&url').then((m) => m.default as string),
			import('jassub/dist/wasm/jassub-worker.wasm?url').then((m) => m.default as string),
			import('jassub/dist/wasm/jassub-worker-modern.wasm?url').then((m) => m.default as string),
			import('jassub/dist/default.woff2?url').then((m) => m.default as string)
		]);
		if (this.closed) return;
		const before = new Set(this.video.parentElement?.querySelectorAll('canvas') ?? []);
		let instance: Jassub;
		try {
			instance = new JASSUB({
				video: this.video,
				subContent: content,
				workerUrl,
				wasmUrl,
				modernWasmUrl,
				availableFonts: { 'liberation sans': fontUrl },
				// The file's own fonts first, then the computer's, then Google's free ones by name.
				queryFonts: 'localandremote'
			});
		} catch {
			// A browser too old for it (no OffscreenCanvas, no WebAssembly): its half-made canvas goes, captions stay plain.
			for (const canvas of this.video.parentElement?.querySelectorAll('canvas') ?? []) if (!before.has(canvas)) canvas.remove();
			throw new Error('No styled subtitles in this browser');
		}
		const original = instance.manualRender.bind(instance);
		// Each picture's time through the player's own subtitle timing.
		instance.manualRender = (frame: Frame, repaint = false) => {
			this.lastFrame = frame;
			return original({ ...frame, mediaTime: this.subTime(frame.mediaTime) }, repaint);
		};
		// "Fill screen" crops the video: the signs stay on the part of the picture they belong to.
		const box = instance._getElementBoundingBox.bind(instance);
		instance._getElementBoundingBox = (el: HTMLElement, w: number, h: number) => {
			if (this.fit() !== 'cover' || !w || !h) return box(el, w, h);
			const { clientWidth, clientHeight, offsetLeft, offsetTop } = el;
			const scale = Math.max(clientWidth / w, clientHeight / h);
			const width = w * scale;
			const height = h * scale;
			return { x: offsetLeft + (clientWidth - width) / 2, y: offsetTop + (clientHeight - height) / 2, width, height };
		};
		this.instance = instance;
		const canvas = instance._canvas;
		canvas.classList.add('styled-subs');
		await instance.ready.catch(() => {});
	}

	/** Draws again now (paused, the delay or the fit changed). */
	repaint(): void {
		const instance = this.instance;
		if (!instance) return;
		if (this.lastFrame) void instance.manualRender(this.lastFrame, true);
		else void instance.resize(true);
	}

	/** The layout changed (fit, full screen): placed again. */
	refit(): void {
		void this.instance?.resize(true);
	}

	destroy(): void {
		this.closed = true;
		const instance = this.instance;
		this.instance = null;
		if (instance) void instance.destroy().catch(() => {});
	}
}
