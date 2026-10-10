<script lang="ts">
	import { onMount } from 'svelte';

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

	function changeComputer() {
		(window as unknown as { CatalogTV: { forget: () => void } }).CatalogTV.forget();
	}
</script>

<svelte:head><title>Settings · Catalog</title></svelte:head>

<div class="settings">
	<h1>Settings</h1>
	<div class="options" data-tv-row data-tv-grid>
		<a href="/tv/profiles" class="option" data-tv-item data-tv-autofocus>
			<strong>Profiles</strong>
			<span>Everyone gets their own Continue Watching and My List.</span>
		</a>
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
