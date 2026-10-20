/**
 * Automatic subtitle timing: works out when someone is talking and moves the subtitles to
 * match, for each part of the video (the matching is src/lib/subtitleAlign.ts, where it's
 * explained and where the numbers come from; the heavy work is subtitleTiming.worker.ts).
 *
 * Two ways to hear the video:
 *   - The whole sound track at once (`analyseTrack`), when the video has a separate one
 *     (Showbox's do: about 22 MB an episode). It's fetched a couple of minutes at a time from
 *     where you are, only while the video has plenty buffered, so it never slows the picture.
 *     The whole episode is timed within half a minute or so, and changing subtitles re-times
 *     them straight away, since the talking is already known.
 *   - Listening as it plays (`listen`), for videos whose sound comes inside the picture's
 *     pieces (Aniwave, 7Movies). That needs a few minutes of talking before its first move.
 *
 * Changing the delay by hand stops it for these subtitles: you know better.
 */
import { delayAt, spoken, type DelayPlan, type TimedCue } from './subtitleAlign';
import { readSoundTrack, soundBetween, soundTrackIn } from './soundTrack';

const RATE = 16000; // what the speech model listens at
const SAMPLES = 512; // one slice (32 ms)
const PIECES_AT_ONCE = 20; // sound-track pieces fetched together (~2 minutes)

export class SubtitleSync {
	private worker: Worker;
	private plan: DelayPlan | null = null;
	private lastSet: number | null = null;
	private heldByHand = false;
	private told = false;
	private applying: ReturnType<typeof setInterval> | undefined;
	private running = false;
	/** Downloading pieces of the sound track right now (for the player's stats and stop log). */
	fetchingSound = false;

	/** The sound track being fetched (its address without the signature), and how to stop it. */
	private track = '';
	private trackStop: AbortController | null = null;

	private capture: ScriptProcessorNode | null = null;
	private liveFits: ReturnType<typeof setInterval> | undefined;
	private pending: number[] = [];
	private pendingStart = -1; // video time of pending[0], by counting samples
	/** How far the video's clock is from the sample count, over the last few seconds. */
	private skews: number[] = [];
	/** Corrected a few times since the last jump: the browser's sound is steady again by then. */
	private settledAfter = 0;
	private fresh = true;

	/** Counts changes of subtitles, so a plan worked out for the ones before is ignored. */
	private round = 0;
	/** Asked which of several subtitles fits best (`bestOf`): their spoken lines, and the answer. */
	private choices: TimedCue[][] = [];
	private choicePlan: DelayPlan | null = null;
	private choosing: ((index: number) => void) | null = null;
	/** Subtitles taken from `choices` (in short): the page showing them next needs no new plan. */
	private chosen = '';

	/** The last plan and how much had been heard, for working out why it did (or didn't) move. */
	last: Record<string, unknown> = {};

	/** Told the delay that fits the part of the video playing now. */
	onDelay: ((delay: number) => void) | null = null;
	/** Told how much slower than written the subtitles run (1 unless made for another speed). */
	onRate: ((rate: number) => void) | null = null;
	/** Told once when the subtitles clearly don't fit this video at all. */
	onMismatch: (() => void) | null = null;

	constructor(
		private readonly video: HTMLVideoElement,
		private readonly cues: () => TimedCue[],
		private readonly delay: () => number,
		/** Whether fetching more of the sound track now is fine (the video has plenty buffered). */
		private readonly canFetch: () => boolean
	) {
		this.worker = new Worker(new URL('./subtitleTiming.worker.ts', import.meta.url), { type: 'module' });
		this.worker.onmessage = (event) => {
			if (event.data.kind === 'best') {
				this.choicePlan = event.data.plan;
				this.choosing?.(event.data.index);
				this.choosing = null;
				return;
			}
			if (event.data.kind !== 'plan' || event.data.round !== this.round) return;
			this.plan = event.data.plan;
			this.last = { plan: this.plan, heard: Math.round(event.data.heard) };
			if (this.plan && !this.plan.fits && !this.told) {
				this.told = true;
				this.onMismatch?.();
			}
			this.apply();
		};
		this.newCues();
	}

	/** Moving the subtitles, while the video plays and auto-timing is on. */
	start(): void {
		this.running = true;
		this.applying ??= setInterval(() => this.apply(), 500);
	}

	stop(): void {
		this.running = false;
		clearInterval(this.applying);
		this.applying = undefined;
	}

	/** Other subtitles: the talking already heard stays, the timing is worked out again. */
	newCues(): void {
		const cues = spokenLines(this.cues());
		// Just taken from the choices, with their plan: nothing to work out again.
		if (this.chosen && inShort(cues) === this.chosen) {
			this.chosen = '';
			return;
		}
		this.chosen = '';
		this.useCues(cues, null);
		this.worker.postMessage({ kind: 'fit' });
	}

	/**
	 * Which of several subtitles (each a list of lines) fits this video best, from the talking
	 * already heard: about a second each. −1 when none of them does. Showing it is `useChoice`.
	 */
	bestOf(sets: TimedCue[][]): Promise<number> {
		this.choosing?.(-1);
		this.choices = sets.map(spokenLines);
		this.worker.postMessage({ kind: 'best', sets: this.choices });
		return new Promise((resolve) => (this.choosing = resolve));
	}

	/** Times the subtitles `bestOf` picked with the plan it found; call just before showing them. */
	useChoice(index: number): void {
		const cues = this.choices[index];
		if (!cues || !this.choicePlan?.fits) return;
		this.useCues(cues, this.choicePlan);
		this.chosen = inShort(cues);
		this.last = { ...this.last, plan: this.plan, chosen: index };
		this.apply();
	}

	private useCues(cues: TimedCue[], plan: DelayPlan | null): void {
		this.plan = plan;
		this.onRate?.(plan?.fits ? plan.rate : 1);
		this.lastSet = null;
		this.heldByHand = false;
		this.told = false;
		this.round++;
		this.worker.postMessage({ kind: 'cues', cues, round: this.round });
	}

	/** Another episode or another audio track: everything heard is thrown away. */
	reset(): void {
		this.trackStop?.abort();
		this.trackStop = null;
		this.track = '';
		this.pending = [];
		this.pendingStart = -1;
		this.chosen = '';
		this.appendInit = null;
		this.appendQueue = [];
		this.appendEnd = -1;
		clearTimeout(this.appendTimer);
		this.worker.postMessage({ kind: 'reset' });
		this.newCues();
	}

	destroy(): void {
		this.stop();
		this.trackStop?.abort();
		clearInterval(this.liveFits);
		this.capture?.disconnect();
		this.worker.terminate();
	}

	/**
	 * Back to the timing it worked out, after the delay was moved by hand (the Reset button).
	 * False when it has none for these subtitles (Reset then goes to 0).
	 */
	backToTiming(): boolean {
		if (!this.plan?.fits || !this.onDelay) return false;
		this.heldByHand = false;
		const wanted = delayAt(this.plan.steps, this.video.currentTime);
		this.lastSet = wanted;
		this.onDelay(wanted);
		return true;
	}

	/** Sets the delay for the part of the video playing now, from the plan. */
	private apply(): void {
		if (!this.running || this.heldByHand || !this.plan?.fits || !this.onDelay) return;
		const current = this.delay();
		// Moved by hand since it last moved them: left alone from now on.
		if (this.lastSet !== null && Math.abs(current - this.lastSet) > 0.05) {
			this.heldByHand = true;
			this.last = { ...this.last, held: true };
			return;
		}
		this.onRate?.(this.plan.rate);
		const wanted = delayAt(this.plan.steps, this.video.currentTime);
		if (Math.abs(wanted - current) < 0.1) return;
		this.lastSet = wanted;
		this.onDelay(wanted);
	}

	/**
	 * The talking already heard in Showbox file `fid` (kept on the computer by an earlier watch,
	 * or by the computer for a TV), used instead of hearing the sound track. False if none.
	 */
	async useKept(fid: number, language: string): Promise<boolean> {
		const key = `kept|${fid}|${language}`;
		if (key === this.track) return true;
		const resp = await fetch(`/api/watch/speech?fid=${fid}&lang=${encodeURIComponent(language)}`).catch(() => null);
		if (!resp?.ok) return false;
		const bytes = new Uint8Array(await resp.arrayBuffer());
		this.reset();
		this.track = key;
		const speech = new Float32Array(bytes.length);
		for (let i = 0; i < bytes.length; i++) speech[i] = bytes[i] === 255 ? NaN : bytes[i] / 254;
		this.worker.postMessage({ kind: 'heard', speech }, [speech.buffer]);
		this.worker.postMessage({ kind: 'fit' });
		return true;
	}

	/** Everything heard so far, as the worker has it. */
	private heardSoFar(): Promise<Float32Array> {
		return new Promise((resolve) => {
			const answer = (event: MessageEvent) => {
				if (event.data.kind !== 'speech') return;
				this.worker.removeEventListener('message', answer);
				resolve(event.data.speech);
			};
			this.worker.addEventListener('message', answer);
			this.worker.postMessage({ kind: 'dump' });
		});
	}

	/** Keeps the talking heard for Showbox file `fid` on the computer (see useKept). */
	private async keepHeard(fid: number, language: string): Promise<void> {
		let speech = await this.heardSoFar();
		// (The worker's list runs on past the end of the video, unheard.)
		let end = speech.length;
		while (end > 0 && Number.isNaN(speech[end - 1])) end--;
		speech = speech.subarray(0, end);
		const bytes = new Uint8Array(speech.length);
		for (let i = 0; i < speech.length; i++) bytes[i] = Number.isNaN(speech[i]) ? 255 : Math.round(Math.min(1, Math.max(0, speech[i])) * 254);
		// (Without saying what it is, the bytes arrive empty.)
		await fetch(`/api/watch/speech?fid=${fid}&lang=${encodeURIComponent(language)}`, {
			method: 'POST',
			body: bytes,
			headers: { 'Content-Type': 'application/octet-stream' }
		}).catch(() => {});
	}

	/**
	 * Fetches and hears the whole sound track in `language` (from the video's main playlist),
	 * from where the video is to the end, then the start. False if it can't be read (the caller
	 * listens instead). `keepAs`: the Showbox file it is, to keep what's heard for next time.
	 */
	async analyseTrack(masterUrl: string, language: string, keepAs = 0): Promise<boolean> {
		const key = `${masterUrl.split('?')[0]}|${language}`;
		if (key === this.track) return true;
		this.reset();
		this.track = key;
		const stop = new AbortController();
		this.trackStop = stop;
		try {
			const playlistUrl = await soundTrackIn(masterUrl, language, stop.signal);
			const track = playlistUrl ? await readSoundTrack(playlistUrl, stop.signal) : null;
			if (!track) {
				this.track = '';
				return false;
			}
			// Groups of pieces, the one playing now first.
			const starts: number[] = [];
			for (let i = 0; i < track.pieces.length; i += PIECES_AT_ONCE) starts.push(i);
			const now = starts.findIndex((s, i) => i === starts.length - 1 || track.pieces[starts[i + 1]].at > this.video.currentTime);
			const order = [...starts.slice(Math.max(0, now)), ...starts.slice(0, Math.max(0, now))];

			let previousEnd = -1;
			for (const first of order) {
				while (!this.canFetch()) {
					await new Promise((r) => setTimeout(r, 1000));
					if (stop.signal.aborted) return true;
				}
				const group = track.pieces.slice(first, first + PIECES_AT_ONCE);
				const last = group[group.length - 1];
				this.fetchingSound = true;
				const { at, samples } = await soundBetween(track, group[0].at, last.at + last.length, RATE, stop.signal).finally(() => (this.fetchingSound = false));
				if (stop.signal.aborted) return true;
				this.worker.postMessage({ kind: 'sound', at, samples, fresh: Math.abs(at - previousEnd) > 0.1 }, [samples.buffer]);
				this.worker.postMessage({ kind: 'fit' });
				previousEnd = at + samples.length / RATE;
			}
			if (keepAs && !stop.signal.aborted) await this.keepHeard(keepAs, language);
			return true;
		} catch {
			if (stop.signal.aborted) return true;
			this.track = '';
			return false;
		}
	}

	/*
	 * The sound the player downloads anyway: hls.js hands each piece of audio to the browser,
	 * and the page passes a copy here (`hearAppended`). For videos whose sound comes inside the
	 * picture's pieces (Showbox's 360p copies while Febbox's limit is on, Aniwave) — nothing extra
	 * is fetched, it's exact (listening through the speakers was about a second out and needed
	 * minutes), and the player keeps five minutes ahead, so that much is timed before it's seen.
	 */
	private appendInit: Uint8Array | null = null;
	private appendQueue: { at: number; length: number; data: Uint8Array }[] = [];
	private appendTimer: ReturnType<typeof setTimeout> | undefined;
	private appendBusy = false;
	private appendEnd = -1;

	/** Times from the sound the player downloads (see above) instead of a separate sound track. */
	useAppended(): void {
		if (this.track === 'appended') return;
		this.reset();
		this.track = 'appended';
	}

	/** A copy of a piece of audio the player just handed the browser (`isInit`: the format piece). */
	hearAppended(data: Uint8Array, at: number, length: number, isInit: boolean): void {
		if (this.track !== 'appended') return;
		if (isInit) {
			this.appendInit = data.slice();
			return;
		}
		this.appendQueue.push({ at, length, data: data.slice() });
		clearTimeout(this.appendTimer);
		// About a minute at a time, or whatever has come once it goes quiet.
		if (this.appendQueue.length >= 10) void this.decodeAppended();
		else this.appendTimer = setTimeout(() => void this.decodeAppended(), 1500);
	}

	private async decodeAppended(): Promise<void> {
		if (this.appendBusy || !this.appendInit || !this.appendQueue.length) return;
		this.appendBusy = true;
		try {
			// The earliest pieces that follow on from each other (a jump leaves a gap).
			this.appendQueue.sort((a, b) => a.at - b.at);
			// (Up to 40 MB at once: pieces with the picture in them can be 25 MB each.)
			let count = 1;
			let bytesSoFar = this.appendQueue[0].data.length;
			while (count < Math.min(10, this.appendQueue.length)) {
				const before = this.appendQueue[count - 1];
				if (Math.abs(this.appendQueue[count].at - (before.at + before.length)) > 0.5) break;
				bytesSoFar += this.appendQueue[count].data.length;
				if (bytesSoFar > 40_000_000) break;
				count++;
			}
			const batch = this.appendQueue.splice(0, count);
			const parts = [this.appendInit, ...batch.map((p) => p.data)];
			const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
			let offset = 0;
			for (const p of parts) {
				bytes.set(p, offset);
				offset += p.length;
			}
			const sound = await new OfflineAudioContext(1, RATE, RATE).decodeAudioData(bytes.buffer);
			if (this.track !== 'appended') return;
			const samples = new Float32Array(sound.length);
			for (let c = 0; c < sound.numberOfChannels; c++) {
				const channel = sound.getChannelData(c);
				for (let i = 0; i < samples.length; i++) samples[i] += channel[i] / sound.numberOfChannels;
			}
			const at = batch[0].at;
			this.worker.postMessage({ kind: 'sound', at, samples, fresh: Math.abs(at - this.appendEnd) > 0.3 }, [samples.buffer]);
			this.worker.postMessage({ kind: 'fit' });
			this.appendEnd = at + sound.duration;
		} catch {
			// A piece the browser can't decode on its own: skipped, the next ones may be fine.
		} finally {
			this.appendBusy = false;
			if (this.appendQueue.length) this.appendTimer = setTimeout(() => void this.decodeAppended(), 200);
		}
	}

	/**
	 * Listens to the video as it plays (`input` is its sound in the page's audio). For videos
	 * without a separate sound track.
	 */
	listen(context: AudioContext, input: AudioNode): void {
		if (this.capture) return;
		this.capture = context.createScriptProcessor(4096, 2, 1);
		// It only runs while connected through to the speakers; this keeps it silent there.
		const sink = context.createGain();
		sink.gain.value = 0;
		input.connect(this.capture);
		this.capture.connect(sink);
		sink.connect(context.destination);
		this.capture.onaudioprocess = (e) => this.hear(context, e.inputBuffer);
		this.liveFits = setInterval(() => {
			if (this.running && !this.track) this.worker.postMessage({ kind: 'fit' });
		}, 10_000);
	}

	/** The sound just played, turned into 16 kHz slices with the video time they belong to. */
	private hear(context: AudioContext, buffer: AudioBuffer): void {
		const v = this.video;
		// The whole track is being heard instead, or there's nothing worth hearing.
		if (this.track || !this.running || this.heldByHand || v.paused || v.seeking || v.muted || v.volume < 0.05 || v.playbackRate !== 1) {
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
		const lead = (context.outputLatency || 0) + (context.baseLatency || 0) + 0.3;
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
		const whole = Math.floor(this.pending.length / SAMPLES) * SAMPLES;
		if (!whole) return;
		const samples = Float32Array.from(this.pending.splice(0, whole));
		const at = this.pendingStart;
		this.pendingStart += whole / RATE;
		if (this.settledAfter > 0) return;
		this.worker.postMessage({ kind: 'sound', at, samples, fresh: this.fresh }, [samples.buffer]);
		this.fresh = false;
	}
}

/** Only the spoken lines, and only their times (all the worker needs). */
function spokenLines(cues: TimedCue[]): TimedCue[] {
	return spoken(cues).map(({ start, end }) => ({ start, end }));
}

/** Enough of a list of lines to tell it from another. */
function inShort(cues: TimedCue[]): string {
	return `${cues.length}:${cues[0]?.start}:${cues[cues.length - 1]?.end}`;
}
