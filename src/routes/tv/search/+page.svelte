<script lang="ts">
	import TvKeyboard from '$lib/tv/TvKeyboard.svelte';
	import TvCard from '$lib/tv/TvCard.svelte';
	import { fromResult, type Tile } from '$lib/tv/tiles';

	/**
	 * Search on the TV: the keyboard on the left, results on the right as you type (right from
	 * the keyboard goes into them). What you typed is kept when you come back from a title.
	 */
	const KEPT = 'catalog:tvSearch';
	let query = $state('');
	try {
		query = sessionStorage.getItem(KEPT) ?? '';
	} catch {}

	let results = $state<Tile[]>([]);
	let searching = $state(false);
	let asked = '';
	let timer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const q = query.trim();
		try {
			sessionStorage.setItem(KEPT, query);
		} catch {}
		clearTimeout(timer);
		if (q.length < 2) {
			results = [];
			searching = false;
			return;
		}
		// Waits for a pause in typing, so it doesn't search every letter.
		timer = setTimeout(async () => {
			asked = q;
			searching = true;
			try {
				const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
				const data = await response.json();
				if (asked === q) results = (data.results ?? []).slice(0, 24).map(fromResult);
			} catch {
				if (asked === q) results = [];
			} finally {
				if (asked === q) searching = false;
			}
		}, 450);
	});
</script>

<svelte:head><title>Search · Catalog</title></svelte:head>

<div class="search">
	<div class="left">
		<p class="typed" class:placeholder={!query}>{query || 'Search'}<span class="caret"></span></p>
		<TvKeyboard bind:value={query} />
	</div>

	<div class="right">
		{#if query.trim().length < 2}
			<p class="hint">Type a film, show or anime with the letters on the left.</p>
		{:else if searching && !results.length}
			<p class="hint">Searching…</p>
		{:else if !results.length}
			<p class="hint">Nothing found for “{query.trim()}”.</p>
		{:else}
			<div class="results" data-tv-row data-tv-grid>
				{#each results as tile (tile.key)}
					<TvCard href={tile.href} title={tile.title} poster={tile.poster} menu={tile.menu} showTitle />
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.search {
		position: absolute;
		inset: 0;
		display: flex;
		gap: 3vw;
		padding: 6vh 3vw 0 1vw;
	}

	.left {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 1.5vw;
	}

	.typed {
		margin: 0;
		min-height: 3.2vw;
		font-size: 2.4vw;
		font-weight: 700;
		border-bottom: 0.2vw solid var(--rule-firm);
		padding-bottom: 0.4vw;
		max-width: 26.5vw;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.placeholder {
		color: var(--ink-faint);
	}

	.caret {
		display: inline-block;
		width: 0.2vw;
		height: 2.2vw;
		margin-left: 0.2vw;
		vertical-align: -0.3vw;
		background: var(--accent);
		animation: blink 1s steps(1) infinite;
	}

	@keyframes blink {
		50% {
			opacity: 0;
		}
	}

	.right {
		flex: 1;
		min-width: 0;
		height: 100%;
		overflow: hidden;
	}

	.hint {
		margin: 3vw 0 0;
		font-size: 1.6vw;
		color: var(--ink-faint);
	}

	/* Posters four across; the highlighted one scrolls into view. */
	.results {
		display: grid;
		grid-template-columns: repeat(4, 12.5vw);
		gap: 2.2vw 1.6vw;
		padding: 2vw 0.8vw 30vh;
		height: 100%;
		overflow: hidden;
		align-content: start;
	}
</style>
