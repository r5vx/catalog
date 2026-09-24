<script lang="ts">
	import { page } from '$app/state';
	import { p } from '$lib/poison';
	import type { Category } from '$lib/server/db/types';

	type Props = {
		categories: Category[];
		countByCategory: Record<number, number>;
		total: number;
		noteCount: number;
		watchingCount?: number;
		active: string;
		poisonMode?: boolean;
	};

	let { categories, countByCategory, total, noteCount, watchingCount = 0, active, poisonMode = false }: Props = $props();
	const pm = $derived(poisonMode);

	/**
	 * Keep sort, search and tag filters when switching category — they're
	 * settings, not something you should have to reapply per tab.
	 */
	function link(slug: string) {
		const params = new URLSearchParams(page.url.search);
		params.delete('cat');
		if (slug) params.set('cat', slug);

		const query = params.toString();
		return query ? `/?${query}` : '/';
	}
</script>

<nav class="tabs" aria-label="Categories">
	<a href={link('')} class="tab" class:active={active === ''}>
		{pm ? p('All') : 'All'} <span class="n tabular">{total}</span>
	</a>

	{#if watchingCount > 0}
		<a href={link('watching')} class="tab" class:active={active === 'watching'}>
			<span aria-hidden="true">▶</span>
			{pm ? p('Continue Watching') : 'Continue Watching'}
			<span class="n tabular">{watchingCount}</span>
		</a>
	{/if}

	{#each categories as category (category.id)}
		<a href={link(category.slug)} class="tab" class:active={active === category.slug}>
			<span aria-hidden="true">{category.emoji}</span>
			{category.name}
			<span class="n tabular">{countByCategory[category.id] ?? 0}</span>
		</a>
	{/each}

	<a href="/notes" class="tab" class:active={active === 'notes'}>
		<span aria-hidden="true">📝</span>
		{pm ? p('Notes') : 'Notes'}
		<span class="n tabular">{noteCount}</span>
	</a>
</nav>

<style>
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		border-bottom: 1px solid var(--rule);
		padding-bottom: 14px;
		margin-bottom: 14px;
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 100px;
		border: 1px solid transparent;
		color: var(--ink-soft);
		font-size: 0.9rem;
		transition:
			background 0.12s ease,
			color 0.12s ease;
	}

	.tab:hover {
		background: var(--surface-2);
		color: var(--ink);
	}

	.tab.active {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
		font-weight: 600;
	}

	.n {
		font-size: 0.75rem;
		opacity: 0.65;
	}
</style>
