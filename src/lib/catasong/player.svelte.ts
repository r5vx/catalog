/**
 * Catasong's sound: one decoded song at a time, played in clips through Web Audio.
 *
 * - Every clip fades in over 12 ms and out at its end, so even 0.1 s is a soft blip, not a click
 *   (owner, 2026-11-26: 0.1 s was "really loud and sharp in my ear").
 * - The volume is its own control (default 40 %), kept on the computer (setting catasongVolume).
 * - An analyser sits after the volume, so the page can draw the sound as it plays.
 * - A song is fetched and decoded as soon as its round or day is known, before Play is pressed
 *   (an AudioContext can decode while it's still waiting for a press to make sound).
 * - Stop really stops: `playing` goes false at once, and what's drawn follows it.
 */
export class SongPlayer {
	playing = $state(false);
	/** Seconds of the clip now playing (or the last one). */
	length = $state(0);
	ready = $state(false);
	loading = $state(false);
	failed = $state(false);
	volume = $state(0.4);

	context: AudioContext | null = null;
	analyser: AnalyserNode | null = null;
	buffer: AudioBuffer | null = null;
	/** Where the music starts in the file: its first sound, not the silence before it. */
	songStart = 0;

	private master: GainNode | null = null;
	private source: AudioBufferSourceNode | null = null;
	private envelope: GainNode | null = null;
	private startedAt = 0;
	private asked = '';
	/*
	 * Closed with its page: nothing it was still fetching may play after. A song that came after the
	 * owner left Guess the Anime made itself a new AudioContext and played with no page left to stop
	 * it, and the game opened again couldn't either (2026-11-26).
	 */
	private closed = false;
	private fetches = new AbortController();

	private ensure(): AudioContext {
		if (this.closed) throw new Error('closed');
		if (!this.context) {
			this.context = new AudioContext();
			this.master = this.context.createGain();
			this.master.gain.value = this.volume;
			this.analyser = this.context.createAnalyser();
			this.analyser.fftSize = 256;
			this.analyser.smoothingTimeConstant = 0.75;
			this.master.connect(this.analyser).connect(this.context.destination);
		}
		return this.context;
	}

	setVolume(value: number) {
		this.volume = Math.min(1, Math.max(0, value));
		if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.02);
	}

	private early = new Map<string, Promise<AudioBuffer | null>>();

	private fetchDecoded(url: string): Promise<AudioBuffer | null> {
		if (this.closed) return Promise.resolve(null);
		const context = this.ensure();
		return fetch(url, { signal: this.fetches.signal })
			.then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
			.then((bytes) => context.decodeAudioData(bytes))
			.catch(() => null);
	}

	/** Starts fetching a song that's likely next, so loading it later is instant. */
	prefetch(url: string) {
		if (this.closed) return;
		if (!this.early.has(url)) this.early.set(url, this.fetchDecoded(url));
	}

	/** Fetches and decodes a song (or takes the one prefetched); a later ask wins over one still coming. */
	async load(url: string): Promise<boolean> {
		if (this.closed) return false;
		this.ensure();
		this.stop();
		this.asked = url;
		this.ready = false;
		this.failed = false;
		this.loading = true;
		this.buffer = null;
		try {
			const early = this.early.get(url);
			this.early.delete(url);
			const decoded = (early ? await early : null) ?? (await this.fetchDecoded(url));
			if (this.closed) return false;
			if (!decoded) throw new Error('no sound');
			if (this.asked !== url) return false;
			this.buffer = decoded;
			this.songStart = firstSound(decoded);
			this.ready = true;
			return true;
		} catch {
			if (this.asked === url) this.failed = true;
			return false;
		} finally {
			if (this.asked === url) this.loading = false;
		}
	}

	/** Forgets the song (another round or day is coming). */
	clear() {
		this.stop();
		this.asked = '';
		this.buffer = null;
		this.ready = false;
		this.failed = false;
		// (A load still coming no longer counts, so it mustn't leave "Loading" up.)
		this.loading = false;
	}

	/** Plays `seconds` from `from` (seconds into the music, after its first sound). */
	play(seconds: number, from = 0) {
		if (this.closed) return;
		const context = this.ensure();
		if (!this.buffer || !this.master) return;
		this.stop(true);
		if (context.state === 'suspended') void context.resume();
		const at = Math.min(this.songStart + from, Math.max(0, this.buffer.duration - 0.1));
		const length = Math.max(0.05, Math.min(seconds, this.buffer.duration - at));
		const source = context.createBufferSource();
		const envelope = context.createGain();
		source.buffer = this.buffer;
		source.connect(envelope).connect(this.master);
		const now = context.currentTime + 0.01;
		const rise = Math.min(0.012, length / 4);
		const fall = Math.min(0.08, length / 3);
		envelope.gain.setValueAtTime(0, now);
		envelope.gain.linearRampToValueAtTime(1, now + rise);
		envelope.gain.setValueAtTime(1, now + length - fall);
		envelope.gain.linearRampToValueAtTime(0, now + length);
		source.start(now, at, length + 0.02);
		const finish = () => {
			if (this.source === source) {
				this.source = null;
				this.playing = false;
			}
		};
		source.onended = finish;
		// If the browser hasn't allowed sound yet the clip never ends by itself: don't stay "playing".
		setTimeout(finish, (length + 0.5) * 1000);
		this.source = source;
		this.envelope = envelope;
		this.startedAt = now;
		this.length = length;
		this.playing = true;
	}

	/** Stops at once (with a 15 ms fade so it doesn't click). */
	stop(quick = false) {
		const source = this.source;
		const envelope = this.envelope;
		this.source = null;
		this.envelope = null;
		this.playing = false;
		if (!source || !this.context) return;
		const now = this.context.currentTime;
		try {
			if (envelope && !quick) {
				envelope.gain.cancelScheduledValues(now);
				envelope.gain.setValueAtTime(envelope.gain.value, now);
				envelope.gain.linearRampToValueAtTime(0, now + 0.015);
				source.stop(now + 0.02);
			} else source.stop();
		} catch {
			/* already ended */
		}
	}

	/** Seconds into the playing clip (0 when stopped). */
	elapsed(): number {
		if (!this.playing || !this.context) return 0;
		return Math.min(this.length, Math.max(0, this.context.currentTime - this.startedAt));
	}

	/** How loud it is right now, 0–1 (for things that pulse with the music). */
	level(): number {
		if (!this.analyser || !this.playing) return 0;
		const data = new Uint8Array(this.analyser.fftSize);
		this.analyser.getByteTimeDomainData(data);
		let sum = 0;
		for (const value of data) sum += ((value - 128) / 128) ** 2;
		return Math.min(1, Math.sqrt(sum / data.length) * 3);
	}

	close() {
		this.closed = true;
		this.fetches.abort();
		this.early.clear();
		this.stop(true);
		void this.context?.close();
		this.context = null;
		this.buffer = null;
	}
}

/** The first moment louder than a whisper, within the first 5 s. */
function firstSound(sound: AudioBuffer): number {
	const samples = sound.getChannelData(0);
	const limit = Math.min(samples.length, sound.sampleRate * 5);
	for (let i = 0; i < limit; i++) if (Math.abs(samples[i]) > 0.02) return Math.max(0, i / sound.sampleRate - 0.01);
	return 0;
}
