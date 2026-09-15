<script lang="ts">
	import { untrack } from 'svelte';
	import { searchTitles } from '$lib/searchClient';
	import type { SearchResult } from '$lib/server/metadata/types';

	type Props = {
		/** Called when a result is chosen. */
		onpick: (result: SearchResult) => void;
		/** Pre-fill the box, e.g. with the title we got wrong. */
		initial?: string;
		placeholder?: string;
		label?: string;
		busyKey?: string | null;
	};

	let {
		onpick,
		initial = '',
		placeholder = 'Search for a title…',
		label = 'Search',
		busyKey = null
	}: Props = $props();

	// Take the starting text once, so typing isn't overwritten by the prop.
	let query = $state(untrack(() => initial));
	let results = $state<SearchResult[]>([]);
	let loading = $state(false);
	let searched = $state(false);
	let problem = $state('');

	let timer: ReturnType<typeof setTimeout>;
	let sequence = 0;

	async function run() {
		const mine = ++sequence;
		const outcome = await searchTitles(query);
		if (mine !== sequence) return;

		if (outcome.ok) {
			results = outcome.results;
			problem = '';
		} else {
			results = [];
			problem = outcome.problem;
		}

		loading = false;
		searched = true;
	}

	function onInput(event: Event) {
		query = (event.target as HTMLInputElement).value;
		clearTimeout(timer);

		if (query.trim().length < 2) {
			results = [];
			searched = false;
			loading = false;
			problem = '';
			return;
		}

		loading = true;
		timer = setTimeout(run, 280);
	}

	/** Enter re-runs immediately — useful when fixing a typo. */
	function onKey(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		clearTimeout(timer);
		if (query.trim().length >= 2) {
			loading = true;
			run();
		}
	}
</script>

<div class="search">
	<input
		type="search"
		value={query}
		{placeholder}
		aria-label={label}
		autocomplete="off"
		oninput={onInput}
		onkeydown={onKey}
	/>

	{#if problem}
		<p class="problem" role="alert">{problem}</p>
	{:else if loading}
		<p class="note faint">Searching…</p>
	{:else if searched && results.length === 0}
		<p class="note faint">Nothing found. Try different wording.</p>
	{/if}

	{#if results.length > 0}
		<ul>
			{#each results as result (result.key)}
				<li>
					<div class="thumb">
						{#if result.posterUrl}
							<img src={result.posterUrl} alt="" loading="lazy" />
						{:else}
							<span aria-hidden="true">?</span>
						{/if}
					</div>
					<div class="info">
						<span class="name">{result.title}</span>
						<span class="facts faint tabular">
							{result.year ?? '—'} · {result.kind}
							{#if result.episodesTotal}· {result.episodesTotal} eps{/if}
						</span>
					</div>
					<button
						type="button"
						class="btn"
						disabled={busyKey === result.key}
						onclick={() => onpick(result)}
					>
						{busyKey === result.key ? 'Saving…' : 'Use this'}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.search {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.note,
	.problem {
		font-size: 0.85rem;
		margin: 0;
	}

	.problem {
		color: var(--accent);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		max-height: 340px;
		overflow-y: auto;
	}

	li {
		display: grid;
		grid-template-columns: 36px 1fr auto;
		gap: 12px;
		align-items: center;
		padding: 9px 12px;
		border-bottom: 1px solid var(--rule);
	}

	li:last-child {
		border-bottom: none;
	}

	.thumb {
		aspect-ratio: 2 / 3;
		max-width: 100%;
		background: var(--surface-2);
		border-radius: 2px;
		overflow: hidden;
		display: grid;
		place-items: center;
		font-size: 0.75rem;
		color: var(--ink-faint);
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.name {
		font-size: 0.9rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.facts {
		font-size: 0.78rem;
	}

	@media (max-width: 520px) {
		li {
			grid-template-columns: 32px 1fr;
			row-gap: 8px;
		}
		li button {
			grid-column: 2 / 3;
			justify-self: start;
		}
	}
</style>
