<script lang="ts">
	import { onMount } from 'svelte';
	import { readSoundTrack, soundBetween, soundTrackIn } from '$lib/soundTrack';
	import { matchWords, parseCues, planFromMatches, stretchesToHear, type HeardWord, type Point } from '$lib/wordTiming';

	/**
	 * The computer timing subtitles by their words, in a window nobody sees (electron/main.cjs opens it
	 * when a screen asks /api/watch/word-timing; src/lib/wordTiming.ts says why). For each job: the
	 * copy's own sound track, up to ten 30-second stretches with dialogue, heard by
	 * Whisper (base.en, the model live captions use), and each subtitle's first three words found in
	 * what was heard. An answer after every stretch once enough agree; kept in the library. The
	 * stretch nearest the start of the job comes first. Closes a minute after the last job.
	 */

	let status = $state('Starting…');
	const RATE = 16000;
	const SPAN = 30;
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
	type Hear = (audio: Float32Array, options: object) => Promise<{ chunks?: { text: string; timestamp: [number, number | null] }[] }>;
	type Job = { key: string; master: string; language: string; sub: string; duration: number };

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
			let idleSince = Date.now();
			while (!stop) {
				const job: Job | null = await fetch('/api/watch/word-timing?work=1')
					.then((r) => (r.ok ? r.json() : { job: null }))
					.then((d) => d.job)
					.catch(() => null);
				if (!job) {
					if (Date.now() - idleSince > 60_000) break;
					await sleep(2000);
					continue;
				}
				await work(hear, job).catch((e) => tell(job, null, 0, 0, true, `failed: ${e}`));
				idleSince = Date.now();
			}
		})()
			.catch((e) => (status = `Failed: ${e}`))
			.finally(() => {
				if (!new URLSearchParams(location.search).has('stay')) window.close();
			});
		return () => (stop = true);
	});

	function tell(job: Job, plan: unknown, matches: number, heard: number, finished: boolean, why?: string, points?: Point[]) {
		return fetch('/api/watch/word-timing', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ key: job.key, plan, matches, heard, finished, why, points })
		}).catch(() => {});
	}

	async function work(hear: Hear, job: Job) {
		status = `Timing ${job.key}`;
		const text = await fetch(`/api/watch/subtitle-content?url=${encodeURIComponent(job.sub)}&lang=en`)
			.then((r) => (r.ok ? r.json() : { content: '' }))
			.then((d) => String(d.content ?? ''))
			.catch(() => '');
		const cues = parseCues(text);
		if (cues.length < 20) return tell(job, null, 0, 0, true, 'no subtitles');
		// The copy's own sound track (a separate one: Showbox's). Copies with the sound inside the
		// picture's pieces keep the listening's timing.
		const playlist = await soundTrackIn(job.master, job.language || 'en');
		const track = playlist ? await readSoundTrack(playlist) : null;
		if (!track) return tell(job, null, 0, 0, true, 'no separate sound track');
		const duration = track.duration || job.duration || cues[cues.length - 1].end;
		const windows = stretchesToHear(cues, duration, 10, SPAN);
		// Test distant scenes first to distinguish a fixed offset from drift.
		const stretches = [...new Set([windows[0], windows[Math.floor(windows.length / 2)], windows.at(-1), ...windows])].filter((n): n is number => n !== undefined);
		const points: Point[] = [];
		let heard = 0;
		let heardWindows = 0;
		for (const [i, from] of stretches.entries()) {
			const { at, samples } = await soundBetween(track, from, from + SPAN, RATE);
			if (!samples.length) continue;
			// Heard 30 s at a time (Whisper's own length): no joining of overlapping parts, whose word
			// times can come out shifted.
			const said: HeardWord[] = [];
			for (let s = 0; s + 3 * RATE <= samples.length; s += 30 * RATE) {
				const part = samples.subarray(s, Math.min(samples.length, s + 30 * RATE));
				const result = await hear(part, { return_timestamps: 'word' }).catch(() => null);
				for (const c of result?.chunks ?? []) if (c.timestamp[0] != null) said.push({ w: c.text.trim(), at: at + s / RATE + c.timestamp[0] });
			}
			points.push(...matchWords(cues, said, at, at + samples.length / RATE));
			heard += samples.length / RATE;
			heardWindows++;
			const plan = planFromMatches(points);
			// An answer as soon as there's one (from three stretches on, so a fluke can't be first).
			if (plan && heardWindows >= 3 && i < stretches.length - 1) await tell(job, plan, points.length, Math.round(heard), false, undefined, points);
		}
		const final = planFromMatches(points);
		await tell(job, final, points.length, Math.round(heard), true, final ? undefined : !stretches.length ? 'subtitles too sparse' : !heardWindows ? 'no audio available' : 'too few words matched', points);
	}
</script>

<svelte:head><title>Word timer · Catalog</title></svelte:head>

<p>{status}</p>
