<!--
	The top of the library, Notes and Watch list: title, buttons, stat tiles
	and the "Back to top" button.
	One component so switching between those tabs never moves anything.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { p } from '$lib/poison';
	import BackToTop from '$lib/BackToTop.svelte';
	import type { Category } from '$lib/server/db/types';

	type Props = {
		categories: Category[];
		countByCategory: Record<number, number>;
		total: number;
		completed: number;
		completedByCategory: Record<number, number>;
		poisonMode?: boolean;
	};

	let { categories, countByCategory, total, completed, completedByCategory, poisonMode = false }: Props = $props();
	const pm = $derived(poisonMode);

	// A category whose tab is hidden loses its tile too.
	const hiddenTabs = $derived<string[]>(page.data.hiddenTabs ?? []);
</script>

<BackToTop />

<header class="masthead">
	<div class="title-row">
		<h1>{pm ? p('Catalog') : 'Catalog'}</h1>
		<div class="header-actions">
			<a href="/settings" class="btn" title="Settings" aria-label="Settings">⚙</a>
			<a href="/browse" class="btn">{pm ? p('Browse') : 'Browse'}</a>
			<a href="/entry/new" class="btn btn-primary">{pm ? '+ Claim giblet' : '+ Add'}</a>
		</div>
	</div>
	<div class="stat-tiles">
		<div class="tile">
			<span class="tile-label">{pm ? 'Consumed' : 'Watched'}</span>
			<span class="tile-value">{completed} <span class="tile-of">of {total}</span></span>
		</div>
		{#each categories.filter((c) => !hiddenTabs.includes(c.slug)) as cat (cat.id)}
			<div class="tile">
				<span class="tile-label">{cat.name}</span>
				<span class="tile-value">{completedByCategory[cat.id] ?? 0} <span class="tile-of">of {countByCategory[cat.id] ?? 0}</span></span>
			</div>
		{/each}
	</div>
</header>

<style>
	.masthead {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 22px;
	}

	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 10px 16px;
	}

	h1 {
		font-size: clamp(1.8rem, 5vw, 2.4rem);
	}

	.header-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	/* On a phone the buttons get their own row rather than running off the
	   right edge, and share the width evenly. */
	@media (max-width: 460px) {
		.header-actions {
			width: 100%;
		}

		.header-actions a:not([aria-label='Settings']) {
			flex: 1;
			justify-content: center;
		}
	}

	/* Library stats: one tile for everything, then one per category. */
	.stat-tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
		gap: 10px;
		margin-top: 14px;
		max-width: 720px;
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 10px 14px;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
	}

	.tile-label {
		font-size: 0.78rem;
		color: var(--ink-soft);
	}

	.tile-value {
		font-size: 1.4rem;
		font-weight: 600;
		line-height: 1.2;
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}

	.tile-of {
		font-size: 0.85rem;
		font-weight: 400;
		color: var(--ink-faint);
	}
</style>
