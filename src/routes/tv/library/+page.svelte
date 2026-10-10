<script lang="ts">
	import TvCard from '$lib/tv/TvCard.svelte';
	import { fromLibrary } from '$lib/tv/tiles';
	import type { PageData } from './$types';

	/** Your library on the TV: pick which part along the top, then the posters, five across. */
	let { data }: { data: PageData } = $props();

	const FILTERS = [
		{ value: '', label: 'All' },
		{ value: 'watching', label: 'Watching' },
		{ value: 'planned', label: 'Want to watch' },
		{ value: 'completed', label: 'Watched' }
	];

	const tiles = $derived(data.items.map(fromLibrary));
</script>

<svelte:head><title>My Library · Catalog</title></svelte:head>

<div class="library">
	<div class="filters" data-tv-row>
		{#each FILTERS as filter (filter.value)}
			<a
				href={filter.value ? `/tv/library?status=${filter.value}` : '/tv/library'}
				class="chip"
				class:on={data.status === filter.value}
				data-tv-item
				data-tv-autofocus={data.status === filter.value || undefined}
				data-sveltekit-replacestate
				data-sveltekit-noscroll
			>
				{filter.label}
			</a>
		{/each}
	</div>

	{#if tiles.length}
		<div class="grid" data-tv-row data-tv-grid>
			{#each tiles as tile (tile.key)}
				<TvCard href={tile.href} title={tile.title} poster={tile.poster} note={tile.note} showTitle />
			{/each}
		</div>
	{:else}
		<p class="empty">Nothing here yet.</p>
	{/if}
</div>

<style>
	.library {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		gap: 1.5vw;
		padding: 6vh 3vw 0 1vw;
	}

	.filters {
		display: flex;
		gap: 1vw;
	}

	.chip {
		padding: 0.7vw 1.6vw;
		border-radius: 100vw;
		background: rgb(255 255 255 / 10%);
		color: var(--ink-soft);
		font-size: 1.4vw;
		font-weight: 700;
		text-decoration: none;
		outline: none;
	}

	.chip.on {
		color: var(--accent);
		box-shadow: inset 0 0 0 0.15vw var(--accent);
	}

	.chip:focus,
	.chip:global(.tv-focused) {
		background: var(--ink);
		color: var(--paper);
	}

	.grid {
		flex: 1;
		display: grid;
		grid-template-columns: repeat(5, 12.5vw);
		gap: 2.2vw 2vw;
		padding: 1.2vw 0.8vw 30vh;
		overflow: hidden;
		align-content: start;
	}

	.empty {
		font-size: 1.6vw;
		color: var(--ink-faint);
	}
</style>
