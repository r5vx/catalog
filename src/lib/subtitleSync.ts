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
import { aacTrackOf, adtsOf, type AacTrack } from './aacFrames';

const RATE = 16000; // what the speech model listens at
const SAMPLES = 512; // one slice (32 ms)
const PIECES_AT_ONCE = 20; // sound-track pieces fetched together (~2 minutes)
const FIRST_ANSWER = 270; // seconds of sound a first answer needs (three 3-minute stretches, 30 s apart)
// Seconds heard before subtitles go on. (An opening song leaves little to go by: Frieren S1E13's
// first answer came with nine minutes heard. Ten minutes of sound is about 2% of a 1080p episode.)
const HEARD_AHEAD = 600;

export class SubtitleSync {
	private worker: Worker;
	private plan: DelayPlan | null = null;
	private lastSet: number | null = null;
	private heldByHand = false;
	private told = false;
	/** Seconds heard when a plan last said these subtitles fit. */
	private fittedWith = 0;
	/** Seconds heard when a plan first said they don't fit (null: none has since one did). */
	private mismatchFrom: number | null = null;
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
	/** Told each time the timing is worked out again: whether these subtitles fit the video yet. */
	onFits: ((fits: boolean) => void) | null = null;

	/** The subtitles showing have a timing that fits. */
	get fits(): boolean {
		return Boolean(this.plan?.fits);
	}

	constructor(
		private readonly video: HTMLVideoElement,
		private readonly cues: () => TimedCue[],
		private readonly delay: () => number,
		/**
		 * Whether fetching more of the sound track now is fine (the video has plenty buffered).
		 * `first`: the first few minutes' worth, which is small and wanted soon.
		 */
		private readonly canFetch: (first: boolean) => boolean
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
			// Fitting over a good part of the video already: a later "doesn't fit" (a long noisy
			// part heard — a friend's Hurt Locker at 1:50, 2026-10-25, put the subtitles back out
			// of time and said they didn't match) keeps the timing that fitted.
			const heardNow = Number(event.data.heard) || 0;
			if (event.data.plan?.fits) this.fittedWith = heardNow;
			else if (event.data.plan && this.plan?.fits && this.fittedWith >= 900) {
				this.last = { ...this.last, heard: Math.round(heardNow), keptFit: true };
				return;
			}
			this.plan = event.data.plan;
			this.last = { plan: this.plan, heard: Math.round(event.data.heard) };
			this.onFits?.(this.fits);
			// "Don't match" only once it still doesn't after three more minutes heard (or most of
			// the video). A video heard bit by bit as it loads (7Movies, Movy) was judged on its first
			// minutes: Netflix captions on 7Movies' longer copy of Dungeon Meshi E6 were called
			// wrong, then fitted.
			if (this.plan?.fits) this.mismatchFrom = null;
			// No longer fitting, after it moved them: put back where they were. (Venom 2's cinema-copy
			// subtitles fit at −22 s for the first minutes, then not at all — and the −22 s stayed.)
			if (this.plan && !this.plan.fits && this.lastSet !== null && !this.heldByHand && this.before !== null) {
				this.lastSet = null;
				this.onDelay?.(this.before);
				this.onRate?.(1);
			}
			if (this.plan && !this.plan.fits && !this.told) {
				const heard = Number(event.data.heard) || 0;
				this.mismatchFrom ??= heard;
				const duration = Number.isFinite(this.video.duration) ? this.video.duration : Infinity;
				if (heard >= this.mismatchFrom + 180 || heard >= duration * 0.8) {
					this.told = true;
					this.onMismatch?.();
				}
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

	/** Worked out again from the start for the subtitles showing (Retime): a delay set by hand is let go. */
	retime(): void {
		this.chosen = '';
		this.newCues();
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
		this.fittedWith = 0;
		this.onRate?.(plan?.fits ? plan.rate : 1);
		this.lastSet = null;
		this.before = null;
		this.heldByHand = false;
		this.told = false;
		this.mismatchFrom = null;
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
		// The delay before it first moved them, to go back to if they stop fitting.
		if (this.lastSet === null) this.before = current;
		this.lastSet = wanted;
		this.onDelay(wanted);
	}
	/** The delay before auto-timing first moved these subtitles (null: it hasn't). */
	private before: number | null = null;

	/**
	 * The talking already heard in Showbox file `fid` (kept on the computer by an earlier watch,
	 * or by the computer for a TV), used instead of hearing the sound track. False if none.
	 */
	async useKept(fid: number, language: string): Promise<boolean> {
		return (await this.useKeptSoFar(fid, language, false)) === 'all';
	}

	/**
	 * For a TV while the computer hears the sound track (/speech-maker): what it has heard so far,
	 * taken again whenever there's more. 'all' once it's finished, 'partial' while it goes on,
	 * 'none' before it has anything. `partial: false` takes only a finished one (the computer's own
	 * player hears the rest itself).
	 */
	async useKeptSoFar(fid: number, language: string, partial = true): Promise<'all' | 'partial' | 'none'> {
		if (this.track === `kept|${fid}|${language}`) return 'all';
		const resp = await fetch(`/api/watch/speech?fid=${fid}&lang=${encodeURIComponent(language)}`).catch(() => null);
		if (!resp?.ok) return 'none';
		const unfinished = resp.headers.get('X-Speech-Partial') === '1';
		if (unfinished && !partial) return 'none';
		const bytes = new Uint8Array(await resp.arrayBuffer());
		// The same as last time: nothing new to fit.
		let heard = 0;
		for (const b of bytes) if (b !== 255) heard++;
		const key = unfinished ? `kept|${fid}|${language}|${heard}` : `kept|${fid}|${language}`;
		if (key === this.track) return 'partial';
		// More of the same file: the worker just takes the longer list, and the timing showing stays
		// meanwhile. (A reset put the speed back to normal until it fitted again: Chernobyl E5's
		// subtitles run 4% fast, so they were 50 s out for a few seconds at each refresh.)
		if (!this.track.startsWith(`kept|${fid}|${language}|`)) this.reset();
		this.track = key;
		const speech = new Float32Array(bytes.length);
		for (let i = 0; i < bytes.length; i++) speech[i] = bytes[i] === 255 ? NaN : bytes[i] / 254;
		this.worker.postMessage({ kind: 'heard', speech }, [speech.buffer]);
		this.worker.postMessage({ kind: 'fit' });
		return unfinished ? 'partial' : 'all';
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

	/** Keeps the talking heard for Showbox file `fid` on the computer (see useKept); `partial` while it goes on. */
	private async keepHeard(fid: number, language: string, partial = false): Promise<void> {
		let speech = await this.heardSoFar();
		// (The worker's list runs on past the end of the video, unheard.)
		let end = speech.length;
		while (end > 0 && Number.isNaN(speech[end - 1])) end--;
		speech = speech.subarray(0, end);
		const bytes = new Uint8Array(speech.length);
		for (let i = 0; i < speech.length; i++) bytes[i] = Number.isNaN(speech[i]) ? 255 : Math.round(Math.min(1, Math.max(0, speech[i])) * 254);
		// (Without saying what it is, the bytes arrive empty.)
		await fetch(`/api/watch/speech?fid=${fid}&lang=${encodeURIComponent(language)}${partial ? '&partial=1' : ''}`, {
			method: 'POST',
			body: bytes,
			headers: { 'Content-Type': 'application/octet-stream' }
		}).catch(() => {});
	}

	/**
	 * Fetches and hears the whole sound track in `language` (from the video's main playlist),
	 * from where the video is to the end, then the start. False if it can't be read (the caller
	 * listens instead). `keepAs`: the Showbox file it is, to keep what's heard for next time.
	 * `from`: where to start instead of where the video is (a TV's place, for /speech-maker), and
	 * `keepAsItGoes`: keep what's heard after each group too, so a TV can time from it straight away.
	 */
	async analyseTrack(masterUrl: string, language: string, keepAs = 0, options: { from?: number; keepAsItGoes?: boolean } = {}): Promise<boolean> {
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
			// Groups of pieces, from the one playing now to the end, then the start. The first is as
			// long as a first answer needs, fetched in one go (Showbox's pieces are 6½ s, so it took
			// two rounds of twenty), so the timing's ready a few seconds sooner.
			const count = track.pieces.length;
			const startAt = options.from ?? this.video.currentTime;
			const here = Math.max(0, track.pieces.findIndex((p) => p.at + p.length > startAt));
			let enough = here + 1;
			while (enough < count && track.pieces[enough].at - track.pieces[here].at < FIRST_ANSWER) enough++;
			const groups: [number, number][] = [[here, enough]];
			for (let i = enough; i < count; i += PIECES_AT_ONCE) groups.push([i, Math.min(count, i + PIECES_AT_ONCE)]);
			for (let i = 0; i < here; i += PIECES_AT_ONCE) groups.push([i, Math.min(here, i + PIECES_AT_ONCE)]);

			let previousEnd = -1;
			let heard = 0;
			for (const [first, end] of groups) {
				// With subtitles off, only the first ten minutes or so (wholeTrack).
				while (!this.canFetch(heard === 0) || (heard >= HEARD_AHEAD && !this.wholeTrack)) {
					await new Promise((r) => setTimeout(r, 1000));
					if (stop.signal.aborted) return true;
				}
				const group = track.pieces.slice(first, end);
				const last = group[group.length - 1];
				this.fetchingSound = true;
				const { at, samples } = await soundBetween(track, group[0].at, last.at + last.length, RATE, stop.signal).finally(() => (this.fetchingSound = false));
				if (stop.signal.aborted) return true;
				this.worker.postMessage({ kind: 'sound', at, samples, fresh: Math.abs(at - previousEnd) > 0.1 }, [samples.buffer]);
				this.worker.postMessage({ kind: 'fit' });
				previousEnd = at + samples.length / RATE;
				heard += samples.length / RATE;
				if (keepAs && options.keepAsItGoes && end !== groups[groups.length - 1][1]) await this.keepHeard(keepAs, language, true);
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
	/**
	 * Whether the whole sound track is wanted (subtitles are on). Before they go on, only the
	 * first few minutes are heard, so the timing is ready the moment they do, without fetching
	 * a whole film's sound for someone who never turns them on.
	 */
	wholeTrack = true;

	private appendInit: Uint8Array | null = null;
	/** Its AAC sound track, when there is one: pieces are kept as plain AAC (aacFrames.ts). */
	private appendTrack: AacTrack | null = null;
	/** `adts`: plain AAC, decoded on its own; else the piece as it came, decoded after the format piece. */
	private appendQueue: { at: number; length: number; data: Uint8Array; adts: boolean }[] = [];
	private appendTimer: ReturnType<typeof setTimeout> | undefined;
	private appendBusy = false;
	private appendEnd = -1;

	/**
	 * Times from the sound the player downloads (see above) instead of a separate sound track.
	 * True when it's newly started (so the pieces downloaded before can be handed over once).
	 */
	useAppended(): boolean {
		if (this.track === 'appended') return false;
		this.reset();
		this.track = 'appended';
		return true;
	}

	/** A copy of a piece of audio the player just handed the browser (`isInit`: the format piece). */
	hearAppended(data: Uint8Array, at: number, length: number, isInit: boolean): void {
		if (this.track !== 'appended') return;
		if (isInit) {
			this.appendInit = data.slice();
			this.appendTrack = aacTrackOf(data);
			return;
		}
		// Only the sound is kept: a 7Movies piece is up to 25 MB, most of it picture.
		const adts = this.appendTrack ? adtsOf(this.appendTrack, data) : null;
		this.appendQueue.push({ at, length, data: adts ?? data.slice(), adts: Boolean(adts) });
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
				if (this.appendQueue[count].adts !== before.adts) break;
				bytesSoFar += this.appendQueue[count].data.length;
				if (bytesSoFar > 40_000_000) break;
				count++;
			}
			const batch = this.appendQueue.splice(0, count);
			// Plain AAC needs nothing in front; MP4 pieces need their format piece.
			const parts = batch[0].adts ? batch.map((p) => p.data) : [this.appendInit, ...batch.map((p) => p.data)];
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
