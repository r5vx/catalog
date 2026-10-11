<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { PreviewStrip, keepPictures, keptPictures, type StripVideo } from '$lib/previewStrip';
	import { canPlayHevc } from '$lib/watch';

	/**
	 * The computer making a video's preview pictures by itself, in a window nobody sees
	 * (electron/main.cjs opens it when /api/watch/strip/prepare asks): for a TV playing it, and the
	 * next episode. Finds the video like the player does, gathers its whole strip from the
	 * smallest copy there is, keeps the pictures as it goes, and closes when done (or after 5
	 * minutes).
	 */
	type File = { fid: number; quality: string; source?: string; shareKey?: string; hevc?: boolean };
	type Episode = { season: number; episode: number; files: File[]; shareKey?: string };

	let status = $state('Starting…');

	const params = page.url.searchParams;
	const video: StripVideo = {
		title: params.get('title') ?? '',
		type: params.get('type') === 'tv' ? 'tv' : 'movie',
		season: Number(params.get('season')) || 0,
		episode: Number(params.get('episode')) || 0
	};

	/**
	 * The copies to try, smallest first: Showbox's from its lowest quality, 7Movies' Orion (480p
	 * pieces), then the rest. The first that gives a link is used.
	 */
	function smallestFirst(files: File[]): File[] {
		const showbox = files.filter((f) => !f.source).sort((a, b) => (parseInt(a.quality) || 9999) - (parseInt(b.quality) || 9999));
		const orion = files.filter((f) => f.source === '7Movies' && f.hevc && canPlayHevc());
		const rest = files.filter((f) => f.source && !f.hevc);
		return [...showbox, ...orion, ...rest];
	}

	async function streamFor(file: File, share: string): Promise<string> {
		const resp = await fetch(`/api/watch/stream?share_key=${file.shareKey || share}&fid=${file.fid}`);
		return resp.ok ? ((await resp.json()).url ?? '') : '';
	}

	onMount(() => {
		let strip: PreviewStrip | null = null;
		const finish = async () => {
			if (strip) await keepPictures(video, await strip.takeFresh());
			const count = strip?.frames.size ?? 0;
			strip?.stop();
			status = `${status === 'Gathering…' || status === 'Starting…' ? 'Done' : status} ${count} pictures.`;
			// ?stay=1 keeps it open, for trying it in a browser.
			if (!params.has('stay')) window.close();
		};
		const giveUp = setTimeout(finish, 5 * 60 * 1000);

		(async () => {
			const query = new URLSearchParams({ title: video.title, type: video.type, year: params.get('year') ?? '', nostream: '1' });
			const data = await (await fetch(`/api/watch/resolve?${query}`)).json().catch(() => null);
			if (!data || data.error) {
				status = 'Not found.';
				return finish();
			}
			let files: File[] = data.files ?? [];
			let share = data.shareKey ?? '';
			if (video.type === 'tv') {
				const ep = (data.episodes?.episodes as Episode[] | undefined)?.find((e) => e.season === video.season && e.episode === video.episode);
				files = ep?.files ?? [];
				share = ep?.shareKey || share;
			}
			let url = '';
			for (const file of smallestFirst(files)) {
				url = await streamFor(file, share).catch(() => '');
				if (url) break;
			}
			if (!url) {
				status = 'No video.';
				return finish();
			}

			status = 'Gathering…';
			strip = new PreviewStrip(url, { copies: 2 });
			await strip.addSaved(await keptPictures(video));
			let sinceKept = 0;
			strip.onFrame = async () => {
				if (++sinceKept < 15) return;
				sinceKept = 0;
				keepPictures(video, await strip!.takeFresh());
			};
			strip.start();
			const check = setInterval(() => {
				if (!strip?.finished) return;
				clearInterval(check);
				clearTimeout(giveUp);
				finish();
			}, 2000);
		})().catch((error) => {
			status = `Failed: ${error}`;
			finish();
		});
	});
</script>

<svelte:head><title>Preview pictures · Catalog</title></svelte:head>

<p>{status}</p>
