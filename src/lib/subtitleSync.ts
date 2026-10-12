/**
 * Automatic subtitle timing: listens to the video while it plays, works out when someone is
 * talking, and moves the subtitles to match (the matching is src/lib/subtitleAlign.ts, where
 * it's explained and where the numbers come from).
 *
 * Talking is spotted by Silero, a small speech-spotting model (static/vad/silero_vad.onnx, run
 * by onnxruntime-web). Both are only fetched once auto-timing is on and something
 * plays, so nothing else waits for it. The sound is taken as it plays, nothing extra is
 * downloaded, so it needs about a minute of listening before its first move.
 *
 * Changing the delay by hand stops it for these subtitles: you know better.
 */
import { FRAME, DelayFollower, recentShift, spoken, type TimedCue } from './subtitleAlign';

type Ort = typeof import('onnxruntime-web/wasm');

let ortLoading: Promise<{ ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession }> | null = null;

/** onnxruntime and the model, loaded once and only when first wanted. */
function loadModel() {
	ortLoading ??= (async () => {
		const [ort, wasm] = await Promise.all([
			import('onnxruntime-web/wasm'),
			import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url')
		]);
		ort.env.wasm.wasmPaths = { wasm: wasm.default };
		ort.env.wasm.numThreads = 1;
		const session = await ort.InferenceSession.create('/vad/silero_vad.onnx');
		return { ort, session };
	})();
	ortLoading.catch(() => (ortLoading = null));
	return ortLoading;
}

const RATE = 16000; // what the model listens at
const SAMPLES = 512; // one slice (32 ms)
const CONTEXT = 64; // the end of the slice before, which the model wants in front of each

export class SubtitleSync {
	private capture: ScriptProcessorNode;
	private sink: GainNode;
	private judging: ReturnType<typeof setInterval> | undefined;
	/** Talking probability for every 32 ms of the video; NaN where it hasn't been heard. */
	private speech = new Float32Array(0);
	private pending: number[] = [];
	private pendingStart = -1; // video time of pending[0], by counting samples
	/** How far the video's clock is from the sample count, over the last few seconds. */
	private skews: number[] = [];
	/** Corrected a few times since the last jump: the browser's sound is steady again by then. */
	private settledAfter = 0;
	private queue: { frame: number; samples: Float32Array; fresh: boolean }[] = [];
	private fresh = true; // the next slice follows a gap (a jump, a pause): the model starts over
	private busy = false;
	private state: Float32Array = new Float32Array(256);
	private previous = new Float32Array(CONTEXT);
	private follower = new DelayFollower();
	private around: number | null = null;
	private lastSet: number | null = null;
	private heldByHand = false;
	private running = false;

	/** The last look, for working out why it did (or didn't) move the subtitles. */
	last: Record<string, unknown> = {};

	/** Told the delay that fits, when one clearly does. */
	onDelay: ((delay: number) => void) | null = null;

	constructor(
		private readonly context: AudioContext,
		input: AudioNode,
		private readonly video: HTMLVideoElement,
		private readonly cues: () => TimedCue[],
		private readonly delay: () => number
	) {
		this.capture = context.createScriptProcessor(4096, 2, 1);
		// It only runs while connected through to the speakers; this keeps it silent there.
		this.sink = context.createGain();
		this.sink.gain.value = 0;
		input.connect(this.capture);
		this.capture.connect(this.sink);
		this.sink.connect(context.destination);
		this.capture.onaudioprocess = (e) => this.hear(e.inputBuffer);
		loadModel().catch(() => {});
	}

	start(): void {
		this.running = true;
		this.judging ??= setInterval(() => this.judge(), 10_000);
	}

	stop(): void {
		this.running = false;
		clearInterval(this.judging);
		this.judging = undefined;
		this.pending = [];
		this.pendingStart = -1;
	}

	/** Other subtitles or another episode: start again. */
	reset(): void {
		this.speech = new Float32Array(0);
		this.pending = [];
		this.pendingStart = -1;
		this.queue = [];
		this.follower.reset();
		this.around = null;
		this.lastSet = null;
		this.heldByHand = false;
	}

	/** The sound just played, turned into 16 kHz slices with the video time they belong to. */
	private hear(buffer: AudioBuffer): void {
		const v = this.video;
		if (!this.running || this.heldByHand || v.paused || v.seeking || v.muted || v.volume < 0.05 || v.playbackRate !== 1) {
			this.pending = [];
			this.pendingStart = -1;
			this.fresh = true;
			return;
		}
		const length = buffer.length;
		const left = buffer.getChannelData(0);
		const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
		const step = buffer.sampleRate / RATE;
		// The video time this sound belongs to. The page hears it a little before it's played:
		// the browser's own output delay, plus about 0.3 s more inside Chromium that it doesn't
		// report (measured against the same episode's sound taken straight from the file).
		const lead = (this.context.outputLatency || 0) + (this.context.baseLatency || 0) + 0.3;
		const startTime = v.currentTime + lead - length / buffer.sampleRate;
		const expected = this.pendingStart + this.pending.length / RATE;
		if (this.pendingStart < 0 || Math.abs(expected - startTime) > 1) {
			this.pending = [];
			this.pendingStart = startTime;
			this.skews = [];
			this.settledAfter = 3;
			this.fresh = true;
		} else {
			// The video's time read here wobbles by a few tenths (it's read whenever the page gets
			// round to it); the sample count doesn't. The count is kept, and every two seconds or
			// so moved by the middle of the differences seen meanwhile.
			this.skews.push(startTime - expected);
			if (this.skews.length >= 24) {
				this.pendingStart += [...this.skews].sort((a, b) => a - b)[12];
				this.skews = [];
				if (this.settledAfter > 0) this.settledAfter--;
			}
		}
		// Averaged down to 16 kHz, in mono, at the level it would be at full volume.
		const gain = 1 / v.volume;
		for (let at = 0; at + step <= length; at += step) {
			let sum = 0;
			let n = 0;
			for (let i = Math.floor(at); i < Math.floor(at + step); i++, n++) sum += left[i] + right[i];
			this.pending.push((sum / (2 * (n || 1))) * gain);
		}
		while (this.pending.length >= SAMPLES) {
			const frame = Math.round(this.pendingStart / FRAME);
			const samples = Float32Array.from(this.pending.splice(0, SAMPLES));
			if (this.settledAfter === 0) {
				this.queue.push({ frame, samples, fresh: this.fresh });
				this.fresh = false;
			}
			this.pendingStart += SAMPLES / RATE;
		}
		void this.listen();
	}

	/** Each slice through the model, one at a time. */
	private async listen(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		try {
			const { ort, session } = await loadModel();
			const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(RATE)]), []);
			while (this.queue.length) {
				const { frame, samples, fresh } = this.queue.shift()!;
				if (fresh) {
					this.state = new Float32Array(256);
					this.previous = new Float32Array(CONTEXT);
				}
				const input = new Float32Array(CONTEXT + SAMPLES);
				input.set(this.previous, 0);
				input.set(samples, CONTEXT);
				this.previous = samples.slice(SAMPLES - CONTEXT);
				const out = await session.run({
					input: new ort.Tensor('float32', input, [1, CONTEXT + SAMPLES]),
					state: new ort.Tensor('float32', this.state, [2, 1, 128]),
					sr
				});
				this.state = out.stateN.data as Float32Array;
				this.record(frame, (out.output.data as Float32Array)[0]);
			}
		} catch {
			this.queue = [];
		} finally {
			this.busy = false;
		}
	}

	private record(frame: number, probability: number): void {
		if (frame < 0) return;
		if (frame >= this.speech.length) {
			const room = Math.max(frame + 1, this.speech.length * 2, Math.ceil(((this.video.duration || 0) + 60) / FRAME));
			const longer = new Float32Array(room).fill(NaN);
			longer.set(this.speech);
			this.speech = longer;
		}
		this.speech[frame] = probability;
	}

	private judge(): void {
		if (!this.onDelay || this.heldByHand) return;
		const current = this.delay();
		// Moved by hand since it last moved them: left alone from now on.
		if (this.lastSet !== null && Math.abs(current - this.lastSet) > 0.05) {
			this.heldByHand = true;
			this.last = { held: true };
			return;
		}
		const cues = spoken(this.cues());
		if (cues.length < 20) return;
		const end = Math.floor(this.video.currentTime / FRAME);
		const reading = recentShift(this.speech, cues, Math.min(end, this.speech.length), this.around);
		if (reading !== null) this.around = reading;
		const move = this.follower.next(reading, current);
		this.last = { reading, move, current };
		if (move === null) return;
		this.lastSet = move;
		this.onDelay(move);
	}
}
