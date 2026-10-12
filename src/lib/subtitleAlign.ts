/**
 * Lining subtitles up with the talking (the maths only; src/lib/subtitleSync.ts listens).
 *
 * The way ffsubsync does it: the episode is cut into 32 ms slices, each marked "someone's
 * talking" or not (by Silero, a small speech-spotting model that music doesn't fool the way
 * plain loudness did), and "a subtitle's showing" or not; the delay where the two agree most is
 * the one. Done over the last two minutes heard, again and again, so subtitles made for a copy
 * of the episode with a longer start or break are followed past each jump.
 */

export const FRAME = 0.032; // seconds per slice (512 samples at 16 kHz)

export type TimedCue = { start: number; end: number; text?: string };

/** Lines that aren't someone talking: songs, "(MUSIC)", "[DOOR OPENS]", signs. */
export function spoken(cues: TimedCue[]): TimedCue[] {
	return cues.filter((cue) => {
		const text = (cue.text ?? 'x').replace(/<[^>]*>/g, '').trim();
		if (!text || /♪|♫/.test(text)) return false;
		if (/^[([][^)\]]*[)\]]$/s.test(text)) return false;
		return cue.end - cue.start < 15;
	});
}

/**
 * +1 where a subtitle shows, −1 where none does, on the 32 ms grid from `from` (subtitle time).
 */
function subtitleGrid(cues: TimedCue[], from: number, frames: number): Int8Array {
	const grid = new Int8Array(frames).fill(-1);
	for (const cue of cues) {
		const a = Math.max(0, Math.floor((cue.start - from) / FRAME));
		const b = Math.min(frames, Math.ceil((cue.end - from) / FRAME));
		for (let i = a; i < b; i++) grid[i] = 1;
	}
	return grid;
}

export type Fit = { shift: number; score: number; runnerUp: number; mean: number };

/**
 * The best delay for the slices `first`..`last` of `speech` (talking probabilities, slice 0 at
 * video time 0; NaN where nothing was heard), tried from `low` to `high` seconds. The score is
 * how much more "talking" and "subtitle" agree than disagree; `runnerUp` is the best more than a
 * second and a half away from it, and `mean` the average, to tell a clear answer from a guess.
 */
export function bestShift(speech: Float32Array, cues: TimedCue[], first: number, last: number, low: number, high: number): Fit {
	const lowK = Math.round(low / FRAME);
	const highK = Math.round(high / FRAME);
	// Subtitle time covered: video time minus the delay.
	const from = first * FRAME - highK * FRAME - 1;
	const frames = Math.ceil((last - first + (highK - lowK)) + 2 / FRAME) + 2;
	const grid = subtitleGrid(cues, from, frames);
	const offset = Math.round(-from / FRAME); // grid index of subtitle time 0

	const talk = new Float32Array(last - first);
	let known = 0;
	for (let i = first; i < last; i++) {
		const p = speech[i];
		talk[i - first] = Number.isNaN(p) ? 0 : p > 0.5 ? 1 : -1;
		if (!Number.isNaN(p)) known++;
	}
	const scores = new Float32Array(highK - lowK + 1);
	for (let k = lowK; k <= highK; k++) {
		let sum = 0;
		const base = first - k + offset;
		for (let i = 0; i < talk.length; i++) {
			const g = base + i;
			if (talk[i] !== 0 && g >= 0 && g < frames) sum += talk[i] * grid[g];
		}
		scores[k - lowK] = known ? sum / known : 0;
	}
	let best = 0;
	for (let j = 1; j < scores.length; j++) if (scores[j] > scores[best]) best = j;
	const apart = Math.round(1.5 / FRAME);
	let runnerUp = -Infinity;
	let total = 0;
	for (let j = 0; j < scores.length; j++) {
		total += scores[j];
		if (Math.abs(j - best) > apart && scores[j] > runnerUp) runnerUp = scores[j];
	}
	return { shift: (best + lowK) * FRAME, score: scores[best], runnerUp, mean: total / scores.length };
}

/** A clear answer: well above the average, and clearly above anything else. */
export function confident(fit: Fit): boolean {
	return fit.score - fit.mean > 0.15 && fit.score - fit.runnerUp > 0.1;
}

/**
 * The delay over the last two minutes heard, up to slice `end` (where the video is now), looked
 * for within 25 seconds of `around`, or within a minute either way the first time (null). Null
 * when it isn't clear (a song, a quiet stretch, not enough heard yet).
 *
 * Tried on Bleach S6E13: the subtitles that fit came out at 0.1 s all the way through, and
 * AnimeTosho's at −17.4 s, stepping to −18.5 s at 15:20 (made for a copy with a longer start
 * and a longer break) — the stepping is why it's worked out again and again rather than once.
 */
export function recentShift(speech: Float32Array, cues: TimedCue[], end: number, around: number | null): number | null {
	const span = Math.round(120 / FRAME);
	const first = Math.max(0, end - span);
	let heard = 0;
	for (let i = first; i < end; i++) if (!Number.isNaN(speech[i])) heard++;
	if (heard < Math.round(45 / FRAME)) return null;
	const fit =
		around === null ? bestShift(speech, cues, first, end, -60, 60) : bestShift(speech, cues, first, end, around - 25, around + 25);
	return confident(fit) ? fit.shift : null;
}

/**
 * Turns readings into moves: only when the last two clear readings agree (within half a
 * second), to the middle of the last three, and only when that's half a second or more
 * from the delay in use. One odd reading (a song, a shout over music) never moves anything.
 */
export class DelayFollower {
	private readings: number[] = [];

	/** The delay to change to now, or null to leave it as it is. */
	next(reading: number | null, current: number): number | null {
		if (reading === null) return null;
		this.readings.push(reading);
		if (this.readings.length > 3) this.readings.shift();
		if (this.readings.length < 2) return null;
		const [a, b] = this.readings.slice(-2);
		if (Math.abs(a - b) > 0.5) return null;
		const middle = [...this.readings].sort((x, y) => x - y)[Math.floor(this.readings.length / 2)];
		const move = Math.round(middle * 10) / 10;
		return Math.abs(move - current) >= 0.5 ? move : null;
	}

	/** Another episode, other subtitles, or a jump: start again. */
	reset(): void {
		this.readings = [];
	}
}
