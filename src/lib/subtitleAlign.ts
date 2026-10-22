/**
 * Lining subtitles up with the talking (the maths only; src/lib/subtitleSync.ts listens).
 *
 * The way ffsubsync does it: the episode is cut into 32 ms slices, each marked "someone's
 * talking" or not (by Silero, a small speech-spotting model that music doesn't fool the way
 * plain loudness did), and "a subtitle's showing" or not; the delay where the two agree most is
 * the one. Worked out for each part of the episode (`fitDelays`), so subtitles made for a copy
 * with a longer start or break are followed past each jump.
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
 * +1 where a subtitle shows, −1 where none does, on a grid of `size` seconds from `from`
 * (subtitle time).
 */
function subtitleGrid(cues: TimedCue[], from: number, frames: number, size = FRAME): Int8Array {
	const grid = new Int8Array(frames).fill(-1);
	// (Coarser steps mark the steps a subtitle mostly covers, so it doesn't come out fatter.)
	const edge = size === FRAME ? [Math.floor, Math.ceil] : [Math.round, Math.round];
	for (const cue of cues) {
		const a = Math.max(0, edge[0]((cue.start - from) / size));
		const b = Math.min(frames, edge[1]((cue.end - from) / size));
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
	const { scores, lowK } = shiftScores(speech, cues, first, last, low, high);
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

/**
 * bestShift done in two passes, about ten times quicker over a film: every 0.128 s first (four
 * slices at a time) for the rough place and whether it's clear, then every 32 ms within half a
 * second of it for the exact delay.
 */
export function quickShift(speech: Float32Array, cues: TimedCue[], first: number, last: number, low: number, high: number): Fit {
	const { scores, lowK } = shiftScores(speech, cues, first, last, low, high, COARSE);
	let best = 0;
	for (let j = 1; j < scores.length; j++) if (scores[j] > scores[best]) best = j;
	const apart = Math.round(1.5 / (FRAME * COARSE));
	let runnerUp = -Infinity;
	let total = 0;
	for (let j = 0; j < scores.length; j++) {
		total += scores[j];
		if (Math.abs(j - best) > apart && scores[j] > runnerUp) runnerUp = scores[j];
	}
	const rough = (best + lowK) * FRAME * COARSE;
	const fine = bestShift(speech, cues, first, last, rough - 0.5, rough + 0.5);
	return { shift: fine.shift, score: scores[best], runnerUp, mean: total / scores.length };
}

const COARSE = 4;

/** The `count` best delays at least 5 seconds apart, best first (found every 0.128 s). */
function topShifts(speech: Float32Array, cues: TimedCue[], first: number, last: number, low: number, high: number, count: number): number[] {
	const { scores, lowK } = shiftScores(speech, cues, first, last, low, high, COARSE);
	const apart = Math.round(5 / (FRAME * COARSE));
	const picked: number[] = [];
	const order = Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a]);
	for (const j of order) {
		if (picked.every((p) => Math.abs(p - j) > apart)) picked.push(j);
		if (picked.length === count) break;
	}
	return picked.map((j) => (j + lowK) * FRAME * COARSE);
}

/**
 * How well talking and subtitles agree at each delay from `low` to `high` (see bestShift), in
 * steps of `step` slices (the talking averaged over each step).
 */
function shiftScores(speech: Float32Array, cues: TimedCue[], first: number, last: number, low: number, high: number, step = 1) {
	const size = FRAME * step;
	const lowK = Math.round(low / size);
	const highK = Math.round(high / size);
	const count = Math.floor((last - first) / step);
	// Subtitle time covered: video time minus the delay.
	const from = first * FRAME - highK * size - 1;
	const frames = count + (highK - lowK) + Math.ceil(2 / size) + 2;
	const grid = subtitleGrid(cues, from, frames, size);
	const offset = Math.round(-from / size); // grid index of subtitle time 0

	const talk = new Float32Array(count);
	let known = 0;
	for (let c = 0; c < count; c++) {
		let sum = 0;
		let heard = 0;
		for (let i = first + c * step; i < first + (c + 1) * step; i++) {
			const p = speech[i];
			if (Number.isNaN(p)) continue;
			sum += p > 0.5 ? 1 : -1;
			heard++;
		}
		talk[c] = heard ? sum / heard : 0;
		known += heard / step;
	}
	const firstK = Math.round((first * FRAME) / size);
	const scores = new Float32Array(highK - lowK + 1);
	for (let k = lowK; k <= highK; k++) {
		let sum = 0;
		const base = firstK - k + offset;
		for (let i = 0; i < count; i++) {
			const g = base + i;
			if (talk[i] !== 0 && g >= 0 && g < frames) sum += talk[i] * grid[g];
		}
		scores[k - lowK] = known ? sum / known : 0;
	}
	return { scores, lowK };
}

/** A clear answer: well above the average, and clearly above anything else. */
export function confident(fit: Fit): boolean {
	return fit.score - fit.mean > 0.15 && fit.score - fit.runnerUp > 0.1;
}

/** From video time `from` on, the subtitles want `delay` seconds. */
export type DelayStep = { from: number; delay: number };

/**
 * What the timing found: the delay for each part of the video, or that these subtitles don't
 * fit it at all (another episode, another show, another cut). `clear` is the share of stretches
 * that gave a clear answer (0–1): how well they fit, to choose between several files.
 */
export type DelayPlan = { steps: DelayStep[]; fits: true; clear: number; rate: number } | { steps: []; fits: false };

const WINDOW = 180; // seconds of video looked at for each stretch
const STRIDE = 30; // a new stretch every this many seconds
const FAR = 150; // how far off the subtitles may be overall, either way
const NEAR = 20; // how far each stretch may differ from that (a longer or shorter break)

/**
 * The delay for every part of the video, the way ffsubsync does it but stretch by stretch:
 *   1. the one delay that fits everything heard so far best, within 2½ minutes either way;
 *   2. every 3-minute stretch (one every 30 s) looked at again within 20 s of that, keeping
 *      only the clear answers, and dropping one that disagrees with the clear answers either
 *      side of it;
 *   3. where neighbouring answers differ by a second or more, the change is put in the longest
 *      quiet spell between them (where a break or a cut was); smaller ones (subtitles that
 *      slowly drift) change halfway.
 * Null while too little is known; `fits: false` when most stretches give no clear answer at all.
 *
 * Tried on the whole of Bleach S1E1 (dub), Bleach S6E13, Frieren S1E5 and Breaking Bad S3E7
 * with every subtitle file Catalog offers: releases cut differently step by a few seconds at the
 * break (HorribleSubs −0.1 s, then −6 s from 7:20), drifting ones (Breaking Bad's HDTV, 1.7 s
 * to 5.7 s) are followed, and files for another episode or another show find no clear stretch.
 */
export function fitDelays(speech: Float32Array, cues: TimedCue[]): DelayPlan | null {
	const plan = fitAtRate(speech, cues, 1);
	if (plan?.fits && plan.clear >= 0.5) return plan;
	// (No answer yet: other speeds are worth trying once four minutes have been heard — a
	// player that only has five minutes ahead never hears enough to rule the normal speed out.)
	let heard = 0;
	for (const p of speech) if (!Number.isNaN(p)) heard++;
	if (!plan && heard * FRAME < 240) return null;
	// Not fitting as they are: made for a copy at another speed? (DVD subtitles at 25 frames a
	// second run 4% fast against a 23.976 film and drift further off as it goes: Madagascar's
	// aXXo ones fit at −0.4 s once stretched.) The speed that fits best, if one clearly does.
	let best = plan;
	for (const rate of RATES) {
		const tried = fitAtRate(speech, cues, rate);
		const toBeat = best?.fits ? best.clear + 0.1 : 0.3;
		if (tried?.fits && tried.clear > toBeat) best = tried;
	}
	return best;
}

/** Speeds subtitles are often made for, against the one the video plays at. */
const RATES = [25 / 23.976, 23.976 / 25, 25 / 24, 24 / 25, 24 / 23.976, 23.976 / 24];

/** fitDelays for the subtitles played `rate` times slower (each time multiplied by it). */
function fitAtRate(speech: Float32Array, cues: TimedCue[], rate: number): DelayPlan | null {
	if (rate !== 1) cues = cues.map((c) => ({ start: c.start * rate, end: c.end * rate }));
	if (cues.length < 20) return null;
	let first = 0;
	while (first < speech.length && Number.isNaN(speech[first])) first++;
	let last = speech.length;
	while (last > first && Number.isNaN(speech[last - 1])) last--;
	if (last - first < 60 / FRAME) return null;

	// With only a few minutes heard (an opening song and one scene) the best overall delay can be
	// a fluke, so the next two best are tried too when the first leaves most stretches unclear.
	let points: { t: number; delay: number }[] = [];
	let tried = 0;
	for (const overall of topShifts(speech, cues, first, last, -FAR, FAR, 3)) {
		const found = stretches(speech, cues, first, last, overall);
		if (found.points.length > points.length) points = found.points;
		tried = found.tried;
		if (points.length / tried >= 0.5) break;
	}
	// "Doesn't fit" only once a good part of the video has been heard (a dozen stretches).
	if (tried >= 12 && points.length / tried < 0.2) return { steps: [], fits: false };
	// Too little to go by yet. One clear stretch once moved Venom 2's subtitles 22 s (they were
	// right as they were): an answer needs three stretches that agree.
	if (points.length < 3) return null;
	// Most stretches unclear: only believed if the whole of what's been heard says the same.
	// Venom 2's HI subtitles "fitted" at −19.4 s on a fifth of the stretches, while the film as a
	// whole had no clear delay at all.
	if (points.length / tried < 0.4) {
		const whole = quickShift(speech, cues, first, last, -FAR, FAR);
		const middle = [...points].sort((a, b) => a.delay - b.delay)[Math.floor(points.length / 2)].delay;
		if (!confident(whole) || Math.abs(whole.shift - middle) > 2) return tried >= 12 ? { steps: [], fits: false } : null;
	}

	// An answer that disagrees with both of its neighbours, which agree with each other, is noise.
	const kept = points.filter((p, i) => {
		const before = points[i - 1];
		const after = points[i + 1];
		if (!before || !after || Math.abs(before.delay - after.delay) > 1) return true;
		return Math.abs(p.delay - before.delay) <= 1 || Math.abs(p.delay - after.delay) <= 1;
	});

	const steps: DelayStep[] = [{ from: 0, delay: round(kept[0].delay) }];
	for (let i = 1; i < kept.length; i++) {
		const previous = steps[steps.length - 1].delay;
		const delay = round(kept[i].delay);
		// (Wobbles of a few tenths are the measuring, not the subtitles: nobody sees them.)
		if (Math.abs(delay - previous) < 0.4) continue;
		const from =
			Math.abs(delay - previous) >= 1
				? quietestBetween(speech, kept[i - 1].t, kept[i].t)
				: (kept[i - 1].t + kept[i].t) / 2;
		steps.push({ from, delay });
	}
	return { steps, fits: true, clear: points.length / tried, rate };
}

/** Each 3-minute stretch with a minute or more heard, looked at within 20 s of `overall`. */
function stretches(speech: Float32Array, cues: TimedCue[], first: number, last: number, overall: number) {
	const span = Math.round(WINDOW / FRAME);
	const stride = Math.round(STRIDE / FRAME);
	const enough = Math.round(60 / FRAME);
	const points: { t: number; delay: number }[] = [];
	let tried = 0;
	for (let a = first; a < last; a += stride) {
		const b = Math.min(last, a + span);
		let heard = 0;
		for (let i = a; i < b; i++) if (!Number.isNaN(speech[i])) heard++;
		if (heard < enough) continue;
		tried++;
		const fit = quickShift(speech, cues, a, b, overall - NEAR, overall + NEAR);
		if (confident(fit)) points.push({ t: ((a + b) / 2) * FRAME, delay: fit.shift });
		if (b === last) break;
	}
	return { points, tried };
}

/** The delay a plan gives for video time `t`. */
export function delayAt(steps: DelayStep[], t: number): number {
	let delay = steps[0]?.delay ?? 0;
	for (const step of steps) {
		if (step.from > t) break;
		delay = step.delay;
	}
	return delay;
}

function round(seconds: number): number {
	return Math.round(seconds * 10) / 10;
}

/** The middle of the longest stretch with no talking between two video times. */
function quietestBetween(speech: Float32Array, from: number, to: number): number {
	const a = Math.floor(from / FRAME);
	const b = Math.min(speech.length, Math.ceil(to / FRAME));
	let bestStart = a;
	let bestLength = 0;
	let runStart = -1;
	for (let i = a; i <= b; i++) {
		const quiet = i < b && !(speech[i] > 0.5);
		if (quiet && runStart < 0) runStart = i;
		if (!quiet && runStart >= 0) {
			if (i - runStart > bestLength) {
				bestLength = i - runStart;
				bestStart = runStart;
			}
			runStart = -1;
		}
	}
	return bestLength ? (bestStart + bestLength / 2) * FRAME : (from + to) / 2;
}
