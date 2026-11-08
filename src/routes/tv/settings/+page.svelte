<script lang="ts">
	import { onMount } from 'svelte';
	import { tvBridge } from '$lib/tvFrameRate';

	/** The TV's settings: the normal layout instead, or a different computer. */
	let onTvApp = $state(false);
	onMount(() => {
		onTvApp = typeof (window as unknown as { CatalogTV?: unknown }).CatalogTV !== 'undefined';
	});

	async function normalLayout() {
		await fetch('/api/tv-layout', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ layout: 'full' })
		});
		window.location.href = '/';
	}

	/* This profile's audio language (audioLanguage.ts): OK steps to the next one. */
	const LANGUAGES = [
		{ code: '', name: 'Original' },
		{ code: 'es', name: 'Spanish' },
		{ code: 'fr', name: 'French' },
		{ code: 'de', name: 'German' },
		{ code: 'hi', name: 'Hindi' }
	];
	let audioLanguage = $state('');
	onMount(() => {
		fetch('/api/profile-audio')
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => {
				if (d) audioLanguage = d.language ?? '';
			})
			.catch(() => {});
	});
	const languageName = $derived(LANGUAGES.find((l) => l.code === audioLanguage)?.name ?? 'Original');
	async function nextLanguage() {
		const at = LANGUAGES.findIndex((l) => l.code === audioLanguage);
		audioLanguage = LANGUAGES[(at + 1) % LANGUAGES.length].code;
		await fetch('/api/profile-audio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: audioLanguage }) }).catch(() => {});
	}

	/* The TV's refresh rate matched to each video's frame rate (TV app 1.7 and later, tvFrameRate.ts). */
	let frameRateKnown = $state(false);
	let frameRateOn = $state(true);
	onMount(() => {
		const tv = tvBridge();
		if (!tv?.frameRateMatching) return;
		frameRateKnown = true;
		frameRateOn = tv.frameRateMatching();
	});
	function toggleFrameRate() {
		frameRateOn = !frameRateOn;
		tvBridge()?.setFrameRateMatching?.(frameRateOn);
	}

	function changeComputer() {
		(window as unknown as { CatalogTV: { forget: () => void } }).CatalogTV.forget();
	}
</script>

<svelte:head><title>Settings · Catalog</title></svelte:head>

<div class="settings">
	<h1>Settings</h1>
	<div class="options" data-tv-row data-tv-grid>
		<a href="/tv/settings/updates" class="option" data-tv-item>
			<strong>Updates</strong>
			<span>Which Catalog this is, and what's new.</span>
		</a>
		<a href="/tv/profiles" class="option" data-tv-item data-tv-autofocus>
			<strong>Profiles</strong>
			<span>Everyone gets their own Continue Watching and My List.</span>
		</a>
		<button type="button" class="option" data-tv-item onclick={nextLanguage}>
			<strong>Audio language: {languageName}</strong>
			<span>For this profile: dubbed in this language where there's a copy in it. OK changes it.</span>
		</button>
		{#if frameRateKnown}
			<button type="button" class="option" data-tv-item onclick={toggleFrameRate}>
				<strong>Match frame rate: {frameRateOn ? 'On' : 'Off'}</strong>
				<span>The TV switches to each video's own frame rate, so films don't judder. The screen goes dark for a moment when it does.</span>
			</button>
		{/if}
		<button type="button" class="option" data-tv-item onclick={normalLayout}>
			<strong>Use the normal layout</strong>
			<span>The same screens as on the computer. Settings → Watch on TV brings this one back.</span>
		</button>
		{#if onTvApp}
			<button type="button" class="option" data-tv-item onclick={changeComputer}>
				<strong>Use a different computer</strong>
				<span>Pick which computer's Catalog this TV shows.</span>
			</button>
		{/if}
	</div>
</div>

<style>
	.settings {
		position: absolute;
		inset: 0;
		padding: 8vh 3vw 0 1vw;
		display: flex;
		flex-direction: column;
		gap: 2.5vw;
	}

	h1 {
		margin: 0;
		font-family: var(--display);
		font-size: 3.2vw;
	}

	.options {
		display: flex;
		flex-direction: column;
		gap: 1.2vw;
		max-width: 55vw;
	}

	.option {
		display: flex;
		flex-direction: column;
		gap: 0.4vw;
		padding: 1.4vw 1.8vw;
		border: none;
		border-radius: 0.8vw;
		background: rgb(255 255 255 / 8%);
		color: var(--ink);
		font: inherit;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
		outline: none;
	}

	.option strong {
		font-size: 1.7vw;
	}

	.option span {
		font-size: 1.25vw;
		color: var(--ink-soft);
	}

	.option:focus,
	.option:global(.tv-focused) {
		background: var(--ink);
		color: var(--paper);
	}

	.option:focus span,
	.option:global(.tv-focused) span {
		color: var(--paper);
	}
</style>
