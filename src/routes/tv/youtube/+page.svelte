<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { FIRE_TV_CODE } from '$lib/tvInstall';

	/**
	 * YouTube from the TV menu: the Fire TV app (1.4 on) opens YouTube's own TV app over Catalog
	 * (android/src/app/catalog/tv/YouTubeView.java), and Catalog goes back Home underneath, which is
	 * where Back on YouTube's home screen returns to. An older TV app can't: this says how to update
	 * it (it installs over the old one and keeps everything).
	 */
	let needsUpdate = $state(false);
	let origin = $state('');

	onMount(() => {
		origin = location.origin;
		const tv = (window as unknown as { CatalogTV?: { openYouTube?: () => void } }).CatalogTV;
		if (tv?.openYouTube) {
			tv.openYouTube();
			goto('/tv', { replaceState: true });
		} else needsUpdate = true;
	});
</script>

<svelte:head><title>YouTube · Catalog</title></svelte:head>

{#if needsUpdate}
	<section class="need">
		<h1>YouTube needs the newer Catalog TV app</h1>
		<p>Open Downloader on this TV, type <strong>{FIRE_TV_CODE}</strong> and choose Install. It updates the app and keeps everything as it is.</p>
		<p class="alt">Or type this address in Downloader: <strong>{origin}/catalog-tv.apk</strong></p>
	</section>
{/if}

<style>
	.need {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: 0 12vw 0 6vw;
		gap: 1.6vw;
	}

	h1 {
		margin: 0;
		font-size: 3vw;
	}

	p {
		margin: 0;
		max-width: 60vw;
		font-size: 1.8vw;
		line-height: 1.5;
		color: var(--ink-soft);
	}

	strong {
		color: var(--ink);
	}

	.alt {
		font-size: 1.5vw;
	}
</style>
