<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { findAndKeepSkips } from '$lib/skipFinder';

	/**
	 * The computer finding an episode's intro and credits by itself, in a window nobody sees
	 * (electron/main.cjs opens it when /api/watch/skip-found/prepare asks): for a TV playing it.
	 * Finds the episode like the player does, compares its sound with a neighbour's, keeps the
	 * answer for both (src/lib/skipFinder.ts) and closes.
	 */
	type File = { fid: number; quality: string; source?: string };
	type Episode = { season: number; episode: number; files: File[]; shareKey?: string; available?: boolean };

	let status = $state('Starting…');
	const params = page.url.searchParams;

	onMount(() => {
		const stop = new AbortController();
		const finish = () => {
			stop.abort();
			// ?stay=1 keeps it open, for trying it in a browser.
			if (!params.has('stay')) window.close();
		};
		const giveUp = setTimeout(finish, 4 * 60 * 1000);

		(async () => {
			const season = Number(params.get('season')) || 0;
			const episode = Number(params.get('episode')) || 0;
			const fid = Number(params.get('fid')) || 0;
			const query = new URLSearchParams({ title: params.get('title') ?? '', type: 'tv', year: params.get('year') ?? '', nostream: '1' });
			const data = await (await fetch(`/api/watch/resolve?${query}`)).json().catch(() => null);
			const episodes = (data?.episodes?.episodes as Episode[] | undefined) ?? [];
			const ep = episodes.find((e) => e.season === season && e.episode === episode);
			const file = ep?.files.find((f) => f.fid === fid);
			if (!ep || !file) {
				status = 'Not found.';
				return;
			}
			const share = ep.shareKey || data.shareKey || '';
			const link = await fetch(`/api/watch/stream?share_key=${share}&fid=${fid}`)
				.then((r) => (r.ok ? (r.json() as Promise<{ url?: string }>) : {}))
				.then((r: { url?: string }) => r.url ?? '');
			const found = await findAndKeepSkips({
				episodes,
				season,
				episode,
				fid,
				quality: file.quality,
				master: link,
				mainShareKey: data.shareKey ?? '',
				language: '',
				canFetch: () => true,
				signal: stop.signal
			});
			status = found ? `Found ${found.map((f) => f.type).join(', ') || 'nothing'}.` : 'Could not compare.';
		})()
			.catch((error) => (status = `Failed: ${error}`))
			.finally(() => {
				clearTimeout(giveUp);
				finish();
			});
	});
</script>

<svelte:head><title>Intros · Catalog</title></svelte:head>

<p>{status}</p>
