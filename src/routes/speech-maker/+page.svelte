<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { SubtitleSync } from '$lib/subtitleSync';

	/**
	 * The computer hearing an episode's (or film's) sound track by itself, in a window nobody
	 * sees (electron/main.cjs opens it when /api/watch/speech/prepare asks): for a TV, so it can
	 * auto-time subtitles without doing that work. Starts where the TV is (`from`), keeps what it
	 * has heard after each part (src/lib/subtitleSync.ts, `keepAsItGoes`), so the TV times from the
	 * first few minutes within seconds, and closes once it has the whole of it.
	 *
	 * Up to 15 minutes: it took 4 minutes to give up before, and a slow laptop busy with other TVs'
	 * jobs never finished in time (mom's Chernobyl E5, 2026-10-31).
	 */
	type File = { fid: number };
	type Episode = { season: number; episode: number; files: File[]; shareKey?: string };

	let status = $state('Starting…');
	const params = page.url.searchParams;

	onMount(() => {
		let sync: SubtitleSync | null = null;
		const finish = () => {
			sync?.destroy();
			// ?stay=1 keeps it open, for trying it in a browser.
			if (!params.has('stay')) window.close();
		};
		const giveUp = setTimeout(finish, 15 * 60 * 1000);

		(async () => {
			const type = params.get('type') === 'tv' ? 'tv' : 'movie';
			const season = Number(params.get('season')) || 0;
			const episode = Number(params.get('episode')) || 0;
			const fid = Number(params.get('fid')) || 0;
			const query = new URLSearchParams({ title: params.get('title') ?? '', type, year: params.get('year') ?? '', nostream: '1' });
			const data = await (await fetch(`/api/watch/resolve?${query}`)).json().catch(() => null);
			let share = data?.shareKey ?? '';
			if (type === 'tv') {
				const ep = (data?.episodes?.episodes as Episode[] | undefined)?.find((e) => e.season === season && e.episode === episode);
				share = ep?.shareKey || share;
			}
			const link = await fetch(`/api/watch/stream?share_key=${share}&fid=${fid}`)
				.then((r) => (r.ok ? (r.json() as Promise<{ url?: string }>) : {}))
				.then((r: { url?: string }) => r.url ?? '');
			if (!link) {
				status = 'No video.';
				return;
			}
			// Not playing anything: a stand-in video, at the start.
			sync = new SubtitleSync(document.createElement('video'), () => [], () => 0, () => true);
			status = 'Hearing…';
			const ok = await sync.analyseTrack(link, params.get('lang') ?? '', fid, { from: Number(params.get('from')) || 0, keepAsItGoes: true });
			status = ok ? 'Done.' : 'Could not read its sound.';
		})()
			.catch((error) => (status = `Failed: ${error}`))
			.finally(async () => {
				// Kept nothing: why, for /api/diagnostics (speechJobs).
				if (status !== 'Done.') {
					await fetch('/api/watch/speech/prepare', {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ fid: Number(params.get('fid')) || 0, lang: params.get('lang') ?? '', outcome: status })
					}).catch(() => {});
				}
				clearTimeout(giveUp);
				finish();
			});
	});
</script>

<svelte:head><title>Hearing · Catalog</title></svelte:head>

<p>{status}</p>
