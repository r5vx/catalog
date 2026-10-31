<script lang="ts">
	import { onMount } from 'svelte';
	import { CaptionWords, LagFinder, TsReader, type Word } from '$lib/liveCaptionTiming';

	/**
	 * The computer timing live captions to the commentary, in a window nobody sees (electron/main.cjs
	 * opens it when a screen asks /api/live/caption-delay). For each channel being watched with
	 * captions: the channel's pieces (the shared copies, so no extra downloads from the site), their
	 * sound heard by Whisper and their caption words, matched (src/lib/liveCaptionTiming.ts). An answer
	 * after the first 5 s heard, firmer after each next part: 5 s, 10 s, then the newest sound as it
	 * comes; once it rests on 40 runs, 10 s once a minute to follow any change. Closes a minute after
	 * the last screen stops asking.
	 */

	let status = $state('Starting…');

	type Sound = { start: number; samples: Float32Array };
	type Channel = {
		id: number;
		reader: TsReader;
		captions: CaptionWords;
		finder: LagFinder;
		had: Set<string>;
		sound: Sound[];
		/** Parts heard, [from, to] on the video's clock. */
		heard: [number, number][];
		/** The first answers come from the sound already there when the channel opened. */
		backlog: [number, number][] | null;
		matches: number;
		lastCheck: number;
	};

	const RATE = 16000;
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
	type Hear = (audio: Float32Array, options: object) => Promise<{ chunks?: { text: string; timestamp: [number, number | null] }[] }>;

	onMount(() => {
		let stop = false;
		(async () => {
			const { pipeline, env } = await import('@huggingface/transformers');
			env.allowLocalModels = false;
			const wasm = env.backends.onnx.wasm;
			if (wasm && crossOriginIsolated) wasm.numThreads = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
			status = 'Loading the speech model…';
			const hear = (await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en', { dtype: 'q8', device: 'wasm' })) as unknown as Hear;
			status = 'Ready.';
			const channels = new Map<number, Channel>();
			let idleSince = Date.now();
			while (!stop) {
				const wanted: number[] = await fetch('/api/live/caption-delay?work=1')
					.then((r) => (r.ok ? r.json() : { channels: [] }))
					.then((d) => d.channels ?? [])
					.catch(() => []);
				for (const id of [...channels.keys()]) if (!wanted.includes(id)) channels.delete(id);
				if (!wanted.length) {
					if (Date.now() - idleSince > 60_000) break;
					await sleep(3000);
					continue;
				}
				idleSince = Date.now();
				let worked = false;
				for (const id of wanted) {
					let channel = channels.get(id);
					if (!channel) {
						channel = { id, reader: new TsReader(), captions: new CaptionWords(), finder: new LagFinder(), had: new Set(), sound: [], heard: [], backlog: null, matches: 0, lastCheck: 0 };
						channels.set(id, channel);
					}
					await takePieces(channel);
					const part = nextPart(channel);
					if (part) {
						worked = true;
						await hearPart(hear, channel, part);
					}
				}
				await sleep(worked ? 100 : 2000);
			}
		})()
			.catch((e) => (status = `Failed: ${e}`))
			.finally(() => {
				if (!new URLSearchParams(location.search).has('stay')) window.close();
			});
		return () => (stop = true);
	});

	/** The channel's new pieces: their captions to the finder, their sound kept (the last two minutes). */
	async function takePieces(channel: Channel) {
		const playlist = await fetch(`/api/live/playlist?ch=${channel.id}`).then((r) => (r.ok ? r.text() : '')).catch(() => '');
		for (const line of playlist.split('\n').filter((l) => l.startsWith('/api/watch/relay'))) {
			let key = line;
			try {
				key = new URL(new URL(line, location.href).searchParams.get('u') ?? line).pathname;
			} catch {}
			if (channel.had.has(key)) continue;
			channel.had.add(key);
			const bytes = await fetch(line).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
			if (!bytes) continue;
			const { frames, sound } = channel.reader.read(new Uint8Array(bytes));
			channel.finder.addCaptions(channel.captions.read(frames));
			if (sound) {
				const samples = await decode(sound.adts);
				if (samples) channel.sound.push({ start: sound.start, samples });
			}
		}
		if (channel.had.size > 200) channel.had = new Set([...channel.had].slice(-100));
		const end = soundEnd(channel);
		channel.sound = channel.sound.filter((s) => s.start + s.samples.length / RATE > end - 120);
	}

	/** ADTS AAC as 16 kHz sound (the page's own decoder, resampling to the context's rate). */
	async function decode(adts: Uint8Array): Promise<Float32Array | null> {
		try {
			const context = new OfflineAudioContext(1, RATE, RATE);
			const buffer = await context.decodeAudioData(adts.slice().buffer);
			return buffer.getChannelData(0).slice();
		} catch {
			return null;
		}
	}

	const soundEnd = (c: Channel) => c.sound.reduce((end, s) => Math.max(end, s.start + s.samples.length / RATE), 0);
	const heardAll = (c: Channel, from: number, to: number) => c.heard.some(([a, b]) => a <= from + 0.5 && b >= to - 0.5);

	/**
	 * What to hear next. First, from the sound already there (about 36 s): the 5 s ending 10 s before
	 * the newest (its captions, about 5 s late, are in), the 5 s before that, then 10 s before that,
	 * then the newest 10. After that the newest sound as it comes, 10 s at a time; once 40 runs agree,
	 * 10 s once a minute.
	 */
	function nextPart(c: Channel): [number, number] | null {
		const end = soundEnd(c);
		if (!end) return null;
		if (!c.backlog) {
			const first = c.sound.reduce((start, s) => Math.min(start, s.start), Infinity);
			c.backlog = ([[end - 15, end - 10], [end - 20, end - 15], [end - 30, end - 20], [end - 10, end]] as [number, number][])
				.map(([a, b]) => [Math.max(a, first), b] as [number, number])
				.filter(([a, b]) => b - a >= 3);
		}
		while (c.backlog.length) {
			const part = c.backlog.shift()!;
			if (!heardAll(c, part[0], part[1])) return part;
		}
		const heardTo = c.heard.reduce((to, [, b]) => Math.max(to, b), 0);
		if (c.matches >= 40) {
			if (Date.now() - c.lastCheck < 60_000 || end - heardTo < 10) return null;
			return [end - 10, end];
		}
		return end - heardTo >= 10 ? [Math.max(heardTo, end - 30), end] : null;
	}

	/** Whisper on one part; its words (on the video's clock) to the finder, and the answer to the server. */
	async function hearPart(hear: Hear, c: Channel, [from, to]: [number, number]) {
		const audio = new Float32Array(Math.round((to - from) * RATE));
		for (const s of c.sound) {
			const offset = Math.round((s.start - from) * RATE);
			for (let i = Math.max(0, -offset); i < s.samples.length && offset + i < audio.length; i++) audio[offset + i] = s.samples[i];
		}
		const startedAt = performance.now();
		const result = await hear(audio, { return_timestamps: 'word' }).catch(() => null);
		c.heard.push([from, to]);
		c.lastCheck = Date.now();
		const words: Word[] = (result?.chunks ?? []).map((w) => ({ w: w.text.trim(), at: from + w.timestamp[0] }));
		c.finder.addHeard(words);
		const found = c.finder.estimate();
		status = `Channel ${c.id}: heard ${(to - from).toFixed(0)} s in ${((performance.now() - startedAt) / 1000).toFixed(1)} s` + (found ? `, captions ${found.lag.toFixed(2)} s late (${found.matches} runs)` : ', no answer yet');
		if (!found) return;
		c.matches = found.matches;
		await fetch('/api/live/caption-delay', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ch: c.id, lag: found.lag, matches: found.matches })
		}).catch(() => {});
	}
</script>

<svelte:head><title>Timing captions · Catalog</title></svelte:head>

<p>{status}</p>
