<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { showbox } from '$lib/showboxHealth.svelte';
	import type { SearchResult } from '$lib/server/metadata/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let query = $state('');
	let results = $state<SearchResult[]>([]);
	let loading = $state(false);
	let searched = $state(false);
	let problem = $state('');

	/** key -> the id of the entry we created, so the row can switch to "Added". */
	let added = $state<Record<string, number>>({});
	/** key -> a category the user corrected before adding. */
	let chosen = $state<Record<string, number>>({});
	let busy = $state<string | null>(null);

	let timer: ReturnType<typeof setTimeout>;
	let sequence = 0;

	onMount(() => {
		showbox.check();
		const q = page.url.searchParams.get('q');
		if (q && q.trim().length >= 2) {
			query = q;
			loading = true;
			runSearch();
		}
	});

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
		timer = setTimeout(runSearch, 280);
	}

	async function runSearch() {
		const mine = ++sequence;
		try {
			const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
				headers: { Accept: 'application/json' }
			});

			// A PIN-locked app answers an expired session with the login page
			// instead of results. Say so, rather than showing an empty list and
			// leaving you wondering why typing does nothing.
			if (response.redirected || !response.headers.get('content-type')?.includes('json')) {
				if (mine === sequence) {
					results = [];
					problem = 'Your session expired. Reload this page and enter your PIN again.';
				}
				return;
			}

			const payload = await response.json();
			// Ignore responses that arrive after a newer search has started.
			if (mine !== sequence) return;

			results = payload.results ?? [];
			problem = '';
		} catch {
			if (mine === sequence) {
				results = [];
				problem = 'Could not reach the search service. Check your internet connection.';
			}
		} finally {
			if (mine === sequence) {
				loading = false;
				searched = true;
			}
		}
	}

	function categoryIdFor(result: SearchResult): number {
		if (chosen[result.key]) return chosen[result.key];
		const match = data.categories.find((c) => c.slug === result.categorySlug);
		return match?.id ?? data.categories[0]?.id;
	}

	async function add(result: SearchResult) {
		busy = result.key;
		try {
			const response = await fetch('/api/entries', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					result,
					categoryId: categoryIdFor(result),
					markWatchedToday: true
				})
			});
			const payload = await response.json();
			added[result.key] = payload.id;
		} finally {
			busy = null;
		}
	}

	const addedCount = $derived(Object.keys(added).length);
</script>

<svelte:head><title>Add to your library · Catalog</title></svelte:head>

<header>
	<a href="/" class="back faint">&larr; Library</a>
	<h1>Add to your library</h1>
	<p class="muted sub">Poster, year and category fill in automatically.</p>
</header>

<!-- svelte-ignore a11y_autofocus -->
<input
	type="search"
	id="lookup"
	class="lookup"
	placeholder="Start typing a title…"
	autocomplete="off"
	autofocus
	value={query}
	oninput={onInput}
	aria-label="Search for something to add"
/>

{#if !data.tmdbEnabled}
	<p class="notice">
		Movies and TV need a free TMDB key — add one in Settings.
	</p>
{/if}

{#if problem}
	<p class="notice problem" role="alert">{problem}</p>
{/if}

<div class="status faint" aria-live="polite">
	{#if loading}
		Searching…
	{:else if addedCount > 0}
		{addedCount} added. <a href="/" class="link">Back to library</a>
	{:else if searched && results.length === 0}
		Nothing found.
	{:else if !searched}
		<a href="/entry/manual" class="link">Manual add</a> ·
		<a href="/import" class="link">Bulk add</a>
	{/if}
</div>

<ul class="results">
	{#each results as result (result.key)}
		{@const isAdded = added[result.key] !== undefined}
		<li class="result" class:is-added={isAdded}>
			<div class="thumb">
				{#if result.posterUrl}
					<img src={result.posterUrl} alt="" loading="lazy" />
				{:else}
					<span class="thumb-empty" aria-hidden="true">?</span>
				{/if}
			</div>

			<div class="info">
				<h2 class="name">{result.title}</h2>
				{#if result.altTitle}
					<p class="alt faint">{result.altTitle}</p>
				{/if}
				<p class="facts faint tabular">
					{result.year ?? '—'} · {result.kind}
					{#if result.episodesTotal}
						· {result.episodesTotal} eps
					{/if}
				</p>
			</div>

			<div class="controls">
				{#if isAdded}
					<span class="done">Added</span>
					<a href="/entry/{added[result.key]}" class="link small">Edit</a>
				{:else}
					<select
						aria-label="Category for {result.title}{result.confident
							? ''
							: ' — close call, worth checking'}"
						class:unsure={!result.confident}
						value={String(categoryIdFor(result))}
						onchange={(e) => (chosen[result.key] = Number(e.currentTarget.value))}
					>
						{#each data.categories as category (category.id)}
							<option value={String(category.id)}>{category.emoji} {category.name}</option>
						{/each}
					</select>
					{#if !result.confident}
						<span class="flag">close call</span>
					{/if}
					<button
						type="button"
						class="btn btn-primary"
						disabled={busy === result.key}
						onclick={() => add(result)}
					>
						{busy === result.key ? 'Adding…' : 'Add'}
					</button>
					<a
						href="/watch?title={encodeURIComponent(result.title)}"
						class="btn btn-watch"
						class:disabled={!showbox.up}
						title={showbox.up ? 'Watch now' : 'showbox.media is down'}
					>▶</a>
				{/if}
			</div>
		</li>
	{/each}
</ul>

{#if searched && results.length > 0}
	<p class="footnote faint">
		<span class="key-swatch"></span> outlined and marked <span class="flag">close call</span>
		= the category is a guess worth checking.
	</p>
{/if}

<style>
	header {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 20px;
	}

	.back {
		font-size: 0.85rem;
		width: fit-content;
	}
	.back:hover {
		color: var(--accent);
	}

	h1 {
		font-size: clamp(1.6rem, 4vw, 2.1rem);
	}

	.sub {
		font-size: 0.92rem;
		max-width: 56ch;
	}

	.lookup {
		font-size: 1.05rem;
		padding: 13px 16px;
	}

	.notice {
		background: var(--warn-bg);
		border: 1px solid var(--warn);
		color: var(--warn);
		border-radius: var(--radius-sm);
		padding: 10px 14px;
		margin: 14px 0 0;
		font-size: 0.88rem;
	}

	.problem {
		background: var(--accent-bg);
		border-color: var(--accent);
		color: var(--accent);
	}

	.flag {
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--warn);
		white-space: nowrap;
	}

	.key-swatch {
		display: inline-block;
		width: 10px;
		height: 10px;
		border: 2px solid var(--warn);
		border-radius: 2px;
		vertical-align: -1px;
	}

	.status {
		font-size: 0.87rem;
		min-height: 1.4em;
		margin: 14px 0 6px;
	}

	.link {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.results {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.result {
		display: grid;
		grid-template-columns: 52px 1fr auto;
		gap: 16px;
		align-items: center;
		padding: 13px 0;
		border-bottom: 1px solid var(--rule);
	}

	.result:first-child {
		border-top: 1px solid var(--rule);
	}

	.result.is-added {
		opacity: 0.6;
	}

	.thumb {
		aspect-ratio: 2 / 3;
		max-width: 100%;
		background: var(--surface-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		overflow: hidden;
		display: grid;
		place-items: center;
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.thumb-empty {
		color: var(--ink-faint);
		font-size: 0.9rem;
	}

	.info {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.name {
		font-family: var(--body);
		font-size: 0.97rem;
		font-weight: 600;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}

	.alt,
	.facts {
		font-size: 0.79rem;
		margin: 0;
		overflow-wrap: anywhere;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.controls select {
		width: auto;
		font-size: 0.85rem;
		padding: 6px 8px;
	}

	.controls select.unsure {
		border-color: var(--warn);
	}

	.done {
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--good);
	}

	.small {
		font-size: 0.82rem;
	}

	.footnote {
		font-size: 0.82rem;
		margin-top: 18px;
	}

	.btn-watch {
		background: var(--good);
		color: var(--paper);
		border-color: var(--good);
		padding: 6px 10px;
		font-size: 0.85rem;
		line-height: 1;
	}

	.btn-watch:hover {
		filter: brightness(1.12);
	}

	.btn-watch.disabled {
		opacity: 0.35;
		pointer-events: none;
	}

	@media (max-width: 620px) {
		.result {
			grid-template-columns: 46px 1fr;
			row-gap: 10px;
		}
		.controls {
			grid-column: 2 / 3;
			justify-content: flex-start;
		}
		.controls select {
			flex: 1;
			min-width: 0;
		}
	}
</style>
