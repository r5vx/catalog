/**
 * The heavy part of auto-timing, off the page so the video never stutters: Silero (the
 * speech-spotting model) over the sound, and the matching in subtitleAlign.ts. The page sends
 * sound and subtitles; this sends back the plan.
 *
 * Messages in:
 *   { kind: 'sound', at, samples, fresh }  16 kHz mono from video time `at`; `fresh` = not
 *                                           straight after the last sound sent
 *   { kind: 'cues', cues, round }           the subtitles in use (only the spoken lines);
 *                                           `round` counts changes of subtitles
 *   { kind: 'fit' }                         work out the plan now
 *   { kind: 'best', sets }                  several subtitles' spoken lines: which fits best?
 *   { kind: 'reset' }                       another episode or another audio track
 *   { kind: 'heard', speech }               the talking, already worked out (kept on the computer);
 *                                           added to what's heard here (what's heard here stays)
 *   { kind: 'probs', first, probs }         talking worked out by a helper (below), from slice `first`
 *   { kind: 'dump' }                        send the talking heard so far back
 * As a helper (several run side by side, each on a part of the sound: subtitleSync.ts):
 *   { kind: 'vad', id, samples, skip }      hear `samples` from scratch, leaving out the first `skip`
 *                                           slices (heard only to settle the model)
 *   → { kind: 'vad', id, probs }
 * Messages out:
 *   { kind: 'plan', plan, heard, round }    plan from fitDelays; heard = seconds analysed;
 *                                           round = the subtitles it's for
 *   { kind: 'best', index, plan }           the set that fits best and its plan (index −1 when
 *                                           none fits)
 *   { kind: 'speech', speech }              answer to 'dump'
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { FRAME, fitDelays, type DelayPlan, type TimedCue } from './subtitleAlign';

const RATE = 16000;
const SAMPLES = 512; // one slice (32 ms)
const CONTEXT = 64; // the end of the slice before, which the model wants in front of each

let sessionLoading: Promise<ort.InferenceSession> | null = null;
function model() {
	ort.env.wasm.wasmPaths = { wasm: wasmUrl };
	ort.env.wasm.numThreads = 1;
	sessionLoading ??= ort.InferenceSession.create('/vad/silero_vad.onnx');
	sessionLoading.catch(() => (sessionLoading = null));
	return sessionLoading;
}

/** Talking probability for every 32 ms of the video; NaN where it hasn't been heard. */
let speech: Float32Array = new Float32Array(0);
let cues: TimedCue[] = [];
let round = 0;
let state: Float32Array = new Float32Array(256);
let previous: Float32Array = new Float32Array(CONTEXT);
/** Messages are handled one at a time, in order (the model is asynchronous). */
let chain: Promise<void> = Promise.resolve();

/** Fits asked for and not done yet: only the last of a run is worked out (a film asks dozens). */
let fitsWaiting = 0;

self.onmessage = (event: MessageEvent) => {
	const message = event.data;
	if (message.kind === 'fit') fitsWaiting++;
	chain = chain
		.then(() => {
			if (message.kind !== 'fit') return handle(message);
			fitsWaiting--;
			// A newer one is behind it: that one answers with more heard.
			if (fitsWaiting > 0) return;
			return handle(message);
		})
		.catch(() => {});
};

async function handle(message: any): Promise<void> {
	if (message.kind === 'reset') {
		speech = new Float32Array(0);
		state = new Float32Array(256);
		previous = new Float32Array(CONTEXT);
	} else if (message.kind === 'cues') {
		cues = message.cues;
		round = message.round;
	} else if (message.kind === 'sound') {
		await hear(message.at, message.samples, message.fresh);
	} else if (message.kind === 'heard') {
		// Talking already worked out elsewhere (by the computer, or kept from an earlier watch):
		// nothing to hear. Anything heard here meanwhile is kept.
		const kept: Float32Array = message.speech;
		if (!speech.length) speech = kept;
		else for (let i = 0; i < kept.length; i++) if (!Number.isNaN(kept[i]) && (i >= speech.length || Number.isNaN(speech[i]))) record(i, kept[i]);
	} else if (message.kind === 'probs') {
		const probs: Float32Array = message.probs;
		for (let i = 0; i < probs.length; i++) record(message.first + i, probs[i]);
	} else if (message.kind === 'vad') {
		const { probs } = await probabilities(message.samples, new Float32Array(256), new Float32Array(CONTEXT));
		const kept = probs.slice(Math.min(probs.length, message.skip));
		self.postMessage({ kind: 'vad', id: message.id, probs: kept }, { transfer: [kept.buffer] });
	} else if (message.kind === 'dump') {
		self.postMessage({ kind: 'speech', speech: speech.slice() });
	} else if (message.kind === 'fit') {
		self.postMessage({ kind: 'plan', plan: fitDelays(speech, cues), heard: heardSeconds(), round });
	} else if (message.kind === 'best') {
		// The one with the most stretches clearly lined up (each costs a fit, about a second).
		const sets: TimedCue[][] = message.sets;
		let index = -1;
		let best: DelayPlan | null = null;
		for (let i = 0; i < sets.length; i++) {
			const plan = fitDelays(speech, sets[i]);
			if (!plan?.fits) continue;
			if (!best?.fits || plan.clear > best.clear) {
				index = i;
				best = plan;
			}
		}
		self.postMessage({ kind: 'best', index, plan: best });
	}
}

/** Seconds of the video heard so far. */
function heardSeconds(): number {
	let heard = 0;
	for (const p of speech) if (!Number.isNaN(p)) heard++;
	return heard * FRAME;
}

async function hear(at: number, samples: Float32Array, fresh: boolean): Promise<void> {
	if (fresh) {
		state = new Float32Array(256);
		previous = new Float32Array(CONTEXT);
	}
	const firstFrame = Math.round(at / FRAME);
	const heard = await probabilities(samples, state, previous);
	state = heard.state;
	previous = heard.previous;
	for (let n = 0; n < heard.probs.length; n++) record(firstFrame + n, heard.probs[n]);
}

/** How sure the model is that someone's talking, for each 32 ms slice of `samples`, going on from `state`. */
async function probabilities(samples: Float32Array, state: Float32Array, previous: Float32Array) {
	const session = await model();
	const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(RATE)]), []);
	const probs = new Float32Array(Math.floor(samples.length / SAMPLES));
	for (let n = 0; n < probs.length; n++) {
		const slice = samples.subarray(n * SAMPLES, (n + 1) * SAMPLES);
		const input = new Float32Array(CONTEXT + SAMPLES);
		input.set(previous, 0);
		input.set(slice, CONTEXT);
		previous = slice.slice(SAMPLES - CONTEXT);
		const out = await session.run({
			input: new ort.Tensor('float32', input, [1, CONTEXT + SAMPLES]),
			state: new ort.Tensor('float32', state, [2, 1, 128]),
			sr
		});
		state = out.stateN.data as Float32Array;
		probs[n] = (out.output.data as Float32Array)[0];
	}
	return { probs, state, previous };
}

function record(frame: number, probability: number): void {
	if (frame < 0) return;
	if (frame >= speech.length) {
		const longer = new Float32Array(Math.max(frame + 1, speech.length * 2, 4096)).fill(NaN);
		longer.set(speech);
		speech = longer;
	}
	speech[frame] = probability;
}
