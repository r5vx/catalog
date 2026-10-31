import { getOrderCache, saveOrderCache } from './db/queries';

/*
 * Live captions' delay, worked out by the computer from the commentary (/caption-timer hears it,
 * src/lib/liveCaptionTiming.ts matches the words) and handed to every screen on that channel: the
 * computer, phones and TVs ask every few seconds (/api/live/caption-delay). The last lag found for
 * each channel is kept, so the next time it's opened the captions start out right before anything
 * has been heard.
 */

type Timing = { lag: number; matches: number; at: number };
const timings = new Map<number, Timing>();
/** When a screen last asked about each channel. */
const asked = new Map<number, number>();
const KEPT = 'live-caption-lags';
let kept: Record<string, number> | null = null;

/** When the hidden page last checked in, and when it was last asked to open. */
let timerSeen = 0;
let timerStarted = 0;

const keptLags = (): Record<string, number> => {
	if (!kept) {
		try {
			kept = (getOrderCache(KEPT)?.value as Record<string, number> | undefined) ?? {};
		} catch {
			kept = {};
		}
	}
	return kept;
};

/** The delay to show a channel's captions with (negative: sooner), or null when nothing's known yet. */
export function captionDelay(channel: number): { delay: number | null; matches: number; heard: boolean } {
	asked.set(channel, Date.now());
	startTimer();
	const timing = timings.get(channel);
	if (timing && Date.now() - timing.at < 10 * 60 * 1000) return { delay: -timing.lag, matches: timing.matches, heard: true };
	const last = keptLags()[String(channel)];
	return { delay: typeof last === 'number' ? -last : null, matches: 0, heard: false };
}

/** The desktop app opens the hidden page (electron/main.cjs); not again while it's checking in. */
function startTimer() {
	if (typeof process.send !== 'function') return;
	const now = Date.now();
	if (now - timerSeen < 30_000 || now - timerStarted < 60_000) return;
	timerStarted = now;
	process.send({ type: 'caption-timer' });
}

/** The channels a screen asked about in the last 30 s (the hidden page's work); also its check-in. */
export function captionChannels(): number[] {
	const now = Date.now();
	timerSeen = now;
	return [...asked.entries()].filter(([, at]) => now - at < 30_000).map(([channel]) => channel);
}

/** What the hidden page found for a channel. */
export function noteCaptionLag(channel: number, lag: number, matches: number) {
	if (!Number.isFinite(lag) || lag < -5 || lag > 30) return;
	timings.set(channel, { lag, matches, at: Date.now() });
	// Kept once it rests on enough words (a rough first answer isn't).
	if (matches >= 15) {
		const lags = keptLags();
		if (lags[String(channel)] !== lag) {
			lags[String(channel)] = Math.round(lag * 100) / 100;
			try {
				saveOrderCache(KEPT, lags, Date.now());
			} catch {}
		}
	}
}
