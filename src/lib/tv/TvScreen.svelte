<script lang="ts">
	import { tick } from 'svelte';
	import TvRow from './TvRow.svelte';
	import TvCard from './TvCard.svelte';
	import { tvFocus } from '$lib/tvNav';
	import { bigPicture, type Tile, type TileRow } from './tiles';

	/**
	 * A browsing screen on the TV, like Netflix's home: a big banner about whatever's highlighted,
	 * and rows of posters under it. The highlighted row slides up to just under the banner.
	 * `later`: rows that take a moment (what's trending), added under the others when they come.
	 */
	let { rows, later = null, empty = 'Nothing here yet.' }: { rows: TileRow[]; later?: Promise<TileRow[]> | null; empty?: string } = $props();

	const firstTile = $derived(rows.find((row) => row.tiles.length)?.tiles[0] ?? null);
	let picked = $state<Tile | null>(null);
	const shown = $derived(picked ?? firstTile);

	// With nothing of your own to show, the first of the rows that come later gets the highlight.
	$effect(() => {
		later?.then(async () => {
			await tick();
			const current = document.activeElement;
			if (current && current !== document.body) return;
			tvFocus(document.querySelector<HTMLElement>('[data-tv-main] [data-tv-item]'));
		});
	});
</script>

<div class="screen">
	<header class="banner">
		{#if shown?.poster}
			<img class="art" src={bigPicture(shown.poster)} alt="" />
		{/if}
		<div class="shade"></div>
		{#if shown}
			<div class="about">
				<h1>{shown.title}</h1>
				{#if shown.meta}<p class="meta">{shown.meta}</p>{/if}
				{#if shown.overview}<p class="overview">{shown.overview}</p>{/if}
			</div>
		{/if}
	</header>

	<div class="window">
		<div class="track" data-tv-track>
			{#each rows.filter((row) => row.tiles.length) as row, r (row.label)}
				<TvRow label={row.label}>
					{#each row.tiles as tile, i (tile.key)}
						<TvCard
							href={tile.href}
							title={tile.title}
							poster={tile.poster}
							note={tile.note}
							progress={tile.progress}
							menu={tile.menu}
							autofocus={r === 0 && i === 0}
							onfocus={() => (picked = tile)}
						/>
					{/each}
				</TvRow>
			{:else}
				{#if !later}<p class="empty">{empty}</p>{/if}
			{/each}

			{#if later}
				{#await later}
					<p class="loading">Loading more…</p>
				{:then more}
					{#each more.filter((row) => row.tiles.length) as row (row.label)}
						<TvRow label={row.label}>
							{#each row.tiles as tile (tile.key)}
								<TvCard
									href={tile.href}
									title={tile.title}
									poster={tile.poster}
									menu={tile.menu}
									onfocus={() => (picked = tile)}
								/>
							{/each}
						</TvRow>
					{/each}
				{/await}
			{/if}
			<div class="end"></div>
		</div>
	</div>
</div>

<style>
	.screen {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
	}

	/* ------------------------------------------------------------ the banner */

	.banner {
		position: relative;
		flex: none;
		height: 44vh;
		overflow: hidden;
	}

	/* The highlighted title's poster, large on the right, fading into the page. */
	.art {
		position: absolute;
		right: 0;
		top: 0;
		width: 55%;
		height: 100%;
		object-fit: cover;
		object-position: center 20%;
		opacity: 0.55;
	}

	.shade {
		position: absolute;
		inset: 0;
		background:
			linear-gradient(90deg, var(--paper) 42%, transparent 75%),
			linear-gradient(0deg, var(--paper) 2%, transparent 45%);
	}

	.about {
		position: relative;
		max-width: 52%;
		padding: 6vh 0 0 1vw;
		display: flex;
		flex-direction: column;
		gap: 1vw;
	}

	h1 {
		margin: 0;
		font-family: var(--display);
		font-size: 3.4vw;
		line-height: 1.1;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}

	.meta {
		margin: 0;
		font-size: 1.4vw;
		font-weight: 600;
		color: var(--ink-soft);
	}

	.overview {
		margin: 0;
		font-size: 1.35vw;
		line-height: 1.45;
		color: var(--ink-soft);
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
	}

	/* ------------------------------------------------------------ the rows */

	.window {
		position: relative;
		flex: 1;
		overflow: hidden;
		padding-left: 1vw;
	}

	.track {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.6vw;
		transition: transform 0.25s ease;
	}

	/* Room for the last row to slide up under the banner. */
	.end {
		height: 40vh;
	}

	.empty,
	.loading {
		margin: 2vw 0;
		font-size: 1.5vw;
		color: var(--ink-faint);
	}
</style>
