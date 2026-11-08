/**
 * The TV's refresh rate matched to the video's frame rate (Fire TV app 1.7 and later,
 * android/src/app/catalog/tv/FrameRate.java), as Netflix does: a film at 24 frames a second
 * on a TV at 60 Hz judders on slow pans, because 60 isn't a multiple of 24.
 *
 * The frame rate is measured from the pictures themselves (the time between one frame and the
 * next, over the first ~2 seconds), so it works for every source. Then the app is asked for a
 * matching mode; a switch blanks the TV for a moment, so the video pauses until the TV is on it
 * and starts again where it was. The TV's own mode comes back when the player closes.
 */
import { tvPlayer } from '$lib/tv';

/** The frame rates videos really have: 23.976, 24, 25, 29.97, 30, 50, 59.94, 60. */
const KNOWN = [24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60];

type Bridge = {
	matchFrameRate?: (fps: number) => string;
	restoreFrameRate?: () => void;
	frameRateMatching?: () => boolean;
	setFrameRateMatching?: (on: boolean) => void;
};

export const tvBridge = (): Bridge | undefined =>
	typeof window === 'undefined' ? undefined : (window as unknown as { CatalogTV?: Bridge }).CatalogTV;

/** The known frame rate `fps` is, or 0 (off by more than 0.04 %: 23.976 and 24 differ by 0.1 %). */
export function snapFrameRate(fps: number): number {
	for (const known of KNOWN) if (Math.abs(fps - known) / known < 0.0004) return known;
	return 0;
}

/** Frame rate from the times between frames: the average of those near the middle one (a dropped frame counts double). */
export function frameRateOf(gaps: number[]): number {
	if (gaps.length === 0) return 0;
	const sorted = [...gaps].sort((a, b) => a - b);
	const middle = sorted[Math.floor(sorted.length / 2)];
	const near = sorted.filter((g) => Math.abs(g - middle) < middle * 0.15);
	return near.length / near.reduce((sum, g) => sum + g, 0);
}

const FRAMES_TO_MEASURE = 48;

/** Matches the TV to `video` while it plays; the returned function stops and puts the TV's own mode back. */
export function matchTvFrameRate(video: HTMLVideoElement): () => void {
	const tv = tvBridge();
	if (!tv?.matchFrameRate || !('requestVideoFrameCallback' in video)) return () => {};
	let stopped = false;
	let handle = 0;
	let source = '';
	let last: { time: number; frames: number } | null = null;
	let gaps: number[] = [];
	let decided = 0; // the frame rate the TV was last matched to
	let switching = false;

	const onFrame = (_now: number, frame: VideoFrameCallbackMetadata) => {
		if (stopped) return;
		if (video.currentSrc !== source) {
			// Another episode or copy: measure it again (a matching TV just answers "same").
			source = video.currentSrc;
			last = null;
			gaps = [];
			decided = 0;
		}
		if (last && frame.presentedFrames - last.frames === 1 && !video.paused && video.playbackRate === 1) {
			const gap = frame.mediaTime - last.time;
			if (gap > 0.005 && gap < 0.2) gaps.push(gap);
		}
		last = { time: frame.mediaTime, frames: frame.presentedFrames };
		if (!decided && !switching && gaps.length >= FRAMES_TO_MEASURE) decide();
		handle = video.requestVideoFrameCallback(onFrame);
	};

	async function decide() {
		const fps = snapFrameRate(frameRateOf(gaps));
		gaps = [];
		if (!fps) return; // not a usual frame rate: measured again from the next frames
		decided = fps;
		let answer = 'unsupported';
		try {
			answer = tv!.matchFrameRate!(fps);
		} catch {}
		if (answer !== 'switching') return;
		switching = true;
		const wasPlaying = !video.paused;
		video.pause();
		await new Promise<void>((done) => {
			const timer = setTimeout(done, 6000);
			tvPlayer.displayChanged = () => {
				clearTimeout(timer);
				done();
			};
		});
		tvPlayer.displayChanged = undefined;
		// The TV shows nothing for a moment after the switch, whatever the app hears.
		await new Promise((r) => setTimeout(r, 1500));
		switching = false;
		if (wasPlaying && !stopped) video.play().catch(() => {});
	}

	// Back in the app after leaving it (the app put the TV's own mode back): measured and matched again.
	const onVisible = () => {
		if (document.visibilityState !== 'hidden') return;
		decided = 0;
		gaps = [];
		last = null;
	};
	document.addEventListener('visibilitychange', onVisible);

	handle = video.requestVideoFrameCallback(onFrame);
	return () => {
		stopped = true;
		document.removeEventListener('visibilitychange', onVisible);
		video.cancelVideoFrameCallback(handle);
		tvPlayer.displayChanged = undefined;
		try {
			tv.restoreFrameRate?.();
		} catch {}
	};
}
