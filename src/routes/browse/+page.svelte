<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import BackBar from '$lib/BackBar.svelte';
	import type { SearchResult } from '$lib/server/metadata/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const TABS = [
		{ value: '', label: 'Everything' },
		{ value: 'movies', label: 'Films' },
		{ value: 'tv', label: 'Series' },
		{ value: 'anime', label: 'Anime' }
	];

	const MODES = [
		{ value: 'trending', label: 'Trending now' },
		{ value: 'popular', label: 'All time' }
	];

	/** Filters live in the URL, so a search you liked is a link you can keep. */
	function setParam(key: string, value: string) {
		const params = new URLSearchParams(window.location.search);
		if (value) params.set(key, value);
		else params.delete(key);
		goto(`?${params.toString()}`, { keepFocus: true, noScroll: true });
	}

	let typing: ReturnType<typeof setTimeout>;
	function onSearch(event: Event) {
		clearTimeout(typing);
		const value = (event.target as HTMLInputElement).value;
		typing = setTimeout(() => setParam('q', value), 350);
	}

	/* ------------------------------------------------- what you already have */

	const owned = $derived(new Set(data.owned));
	const keyOf = (result: SearchResult) => `${result.source}:${result.sourceId}`;

	/** Added during this visit — the page doesn't reload, so it tracks its own. */
	let justAdded = $state<Record<string, number>>({});
	let busy = $state<string | null>(null);
	let problem = $state('');

	const have = (result: SearchResult) => owned.has(keyOf(result)) || keyOf(result) in justAdded;

	async function add(result: SearchResult, status: string) {
		busy = keyOf(result);
		problem = '';

		try {
			const response = await fetch('/api/add', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ source: result.source, sourceId: result.sourceId, status })
			});

			if (!response.ok) {
				problem = 'That could not be added. Try again in a moment.';
				return;
			}

			const added = await response.json();
			justAdded = { ...justAdded, [keyOf(result)]: added.id };
		} catch {
			problem = 'That could not be added — no connection.';
		} finally {
			busy = null;
		}
	}

	/* ------------------------------------------------------- show me more */

	/**
	 * Pages loaded on top of the first, per shelf.
	 *
	 * The server sends page one so the page renders with something on it; every
	 * "Show more" after that appends rather than reloading, because the whole
	 * point is to keep going without losing what you were already looking at.
	 */
	let extra = $state<Record<string, SearchResult[]>>({});
	let at = $state<Record<string, number>>({});
	let loading = $state<string | null>(null);
	let ended = $state<Record<string, boolean>>({});

	// A change of category or trending/all-time replaces the shelves entirely,
	// so anything loaded on top of the old ones has to go with them.
	let showing = $state('');

	$effect(() => {
		const signature = `${data.cat}:${data.mode}`;
		if (showing === signature) return;

		showing = signature;
		extra = {};
		at = {};
		ended = {};
	});

	const shelfResults = (shelf: { key: string; results: SearchResult[] }) => [
		...shelf.results,
		...(extra[shelf.key] ?? [])
	];

	async function more(shelf: { key: string; results: SearchResult[]; page: number }) {
		loading = shelf.key;

		try {
			const next = (at[shelf.key] ?? shelf.page) + 1;
			const response = await fetch(`/api/browse?cat=${shelf.key}&mode=${data.mode}&page=${next}`);

			if (!response.ok) {
				ended = { ...ended, [shelf.key]: true };
				return;
			}

			const payload = await response.json();
			const results: SearchResult[] = payload.results ?? [];

			// Pages overlap now and then, and a duplicate key would take the
			// list down with it.
			const already = new Set(shelfResults(shelf).map((one) => one.key));
			const fresh = results.filter((one) => !already.has(one.key));

			if (fresh.length === 0) {
				ended = { ...ended, [shelf.key]: true };
				return;
			}

			extra = { ...extra, [shelf.key]: [...(extra[shelf.key] ?? []), ...fresh] };
			at = { ...at, [shelf.key]: next };
		} catch {
			ended = { ...ended, [shelf.key]: true };
		} finally {
			loading = null;
		}
	}

	/** Where "back" should return to, including whatever you searched for. */
	const here = $derived(`/browse${page.url.search}`);

	const link = (result: SearchResult) =>
		`/title/${result.source}/${encodeURIComponent(result.sourceId)}?back=${encodeURIComponent(here)}`;
</script>

<svelte:head><title>Browse · Catalog</title></svelte:head>

<BackBar />

<header class="masthead">
	<h1>Browse everything</h1>
	<p class="muted">
		Every film, series and anime the databases know about — not only what you've added.
	</p>
</header>

<div class="toolbar">
	<input
		type="search"
		placeholder="Search for anything…"
		value={data.q}
		oninput={onSearch}
		aria-label="Search every title"
	/>
</div>

<nav class="tabs">
	{#each TABS as tab (tab.value)}
		<button
			type="button"
			class:active={data.cat === tab.value}
			onclick={() => setParam('cat', tab.value)}
		>
			{tab.label}
		</button>
	{/each}

	<!-- Only meaningful for the shelves; a search is a search either way. -->
	{#if !data.q}
		<span class="modes">
			{#each MODES as option (option.value)}
				<button
					type="button"
					class="mode"
					class:active={data.mode === option.value}
					onclick={() => setParam('mode', option.value === 'trending' ? '' : option.value)}
				>
					{option.label}
				</button>
			{/each}
		</span>
	{/if}
</nav>

{#if !data.tmdbEnabled}
	<p class="msg" role="status">
		Without a TMDB key this only finds anime. <a href="/settings/services">Add one</a> and films
		and series appear here too.
	</p>
{/if}

{#if problem}
	<p class="msg bad" role="alert">{problem}</p>
{/if}

{#snippet card(result: SearchResult)}
	<li class:mine={have(result)}>
		<a href={link(result)} class="poster">
			{#if result.posterUrl}
				<img src={result.posterUrl} alt="" loading="lazy" />
			{:else}
				<span class="fallback" aria-hidden="true">?</span>
			{/if}
			{#if have(result)}<span class="tick" title="In your library">&check;</span>{/if}
		</a>

		<a href={link(result)} class="name">{result.title}</a>

		<p class="sub faint tabular">
			{result.year ?? '—'} · {result.kind}{#if result.externalRating}&nbsp;· {result.externalRating.toFixed(
					1
				)}{/if}
		</p>

		{#if result.overview}
			<p class="blurb">{result.overview}</p>
		{/if}

		{#if justAdded[keyOf(result)]}
			<a class="added" href="/entry/{justAdded[keyOf(result)]}">Added &rarr;</a>
		{:else if have(result)}
			<span class="added">In your library</span>
		{:else}
			<div class="actions">
				<button
					type="button"
					class="btn tiny"
					disabled={busy === keyOf(result)}
					onclick={() => add(result, 'planned')}
				>
					Watchlist
				</button>
				<button
					type="button"
					class="btn tiny"
					disabled={busy === keyOf(result)}
					onclick={() => add(result, 'completed')}
				>
					Seen it
				</button>
			</div>
		{/if}
	</li>
{/snippet}

{#if data.q}
	{#if data.results.length === 0}
		<p class="empty muted">Nothing found for that.</p>
	{:else}
		<ul class="grid">
			{#each data.results as result (result.key)}
				{@render card(result)}
			{/each}
		</ul>
	{/if}
{:else if data.shelves.length === 0}
	<p class="empty muted">Nothing to show. Check your connection, or search for a title.</p>
{:else}
	{#each data.shelves as shelf (shelf.key)}
		<section class="shelf">
			<h2>{shelf.label}</h2>
			<ul class="grid">
				{#each shelfResults(shelf) as result (result.key)}
					{@render card(result)}
				{/each}
			</ul>

			{#if ended[shelf.key]}
				<p class="faint end">That's everything {shelf.key === 'anime' ? 'AniList' : 'TMDB'} has here.</p>
			{:else}
				<button
					type="button"
					class="btn more"
					disabled={loading === shelf.key}
					onclick={() => more(shelf)}
				>
					{loading === shelf.key ? 'Finding more…' : 'Show more'}
				</button>
			{/if}
		</section>
	{/each}
{/if}

<style>
	.masthead {
		margin-bottom: 18px;
	}

	h1 {
		font-size: clamp(1.5rem, 4vw, 2rem);
	}

	.muted {
		margin: 4px 0 0;
		font-size: 0.92rem;
	}

	.toolbar {
		margin-bottom: 12px;
	}

	.tabs {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		margin-bottom: 22px;
		border-bottom: 1px solid var(--rule);
		padding-bottom: 10px;
	}

	.tabs button {
		background: none;
		border: 1px solid transparent;
		border-radius: 100px;
		padding: 5px 13px;
		font-size: 0.86rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.tabs button:hover {
		color: var(--ink);
	}

	.tabs button.active {
		background: var(--accent-bg);
		border-color: var(--accent);
		color: var(--accent);
		font-weight: 600;
	}

	/* Pushed to the far end: a different question from which category. */
	.modes {
		margin-left: auto;
		display: inline-flex;
		gap: 2px;
		border: 1px solid var(--rule);
		border-radius: 100px;
		padding: 2px;
	}

	.mode {
		padding: 4px 12px;
		font-size: 0.82rem;
	}

	.tabs .mode.active {
		background: var(--accent);
		border-color: transparent;
		color: var(--accent-ink);
	}

	.shelf .more {
		margin-top: 16px;
	}

	.end {
		font-size: 0.8rem;
		margin: 16px 0 0;
	}

	.msg {
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius-sm);
		padding: 9px 13px;
		margin: 0 0 18px;
		font-size: 0.88rem;
		background: var(--surface);
	}

	.msg a {
		color: var(--accent);
	}

	.bad {
		border-color: var(--accent);
		color: var(--accent);
	}

	.shelf {
		margin-bottom: 34px;
	}

	.shelf h2 {
		font-size: 1.02rem;
		margin: 0 0 14px;
	}

	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 24px 16px;
	}

	.poster {
		position: relative;
		display: grid;
		place-items: center;
		aspect-ratio: 2 / 3;
		background: var(--surface-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		overflow: hidden;
		margin-bottom: 7px;
	}

	.poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.poster:hover {
		border-color: var(--accent);
	}

	.fallback {
		font-size: 1.8rem;
		opacity: 0.4;
	}

	/* Already yours: still there, but not what you came here to find. */
	.mine .poster img {
		opacity: 0.45;
	}

	.tick {
		position: absolute;
		top: 6px;
		right: 6px;
		background: var(--good);
		color: var(--paper);
		width: 22px;
		height: 22px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-size: 0.75rem;
		font-weight: 700;
	}

	.name {
		font-size: 0.9rem;
		font-weight: 600;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}

	.name:hover {
		color: var(--accent);
	}

	.sub {
		font-size: 0.78rem;
		margin: 2px 0 0;
	}

	.blurb {
		font-size: 0.77rem;
		line-height: 1.5;
		color: var(--ink-soft);
		margin: 5px 0 0;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.actions {
		display: flex;
		gap: 6px;
		margin-top: 8px;
	}

	.tiny {
		font-size: 0.74rem;
		padding: 4px 9px;
	}

	.added {
		display: inline-block;
		margin-top: 8px;
		font-size: 0.76rem;
		color: var(--good);
		font-weight: 600;
	}

	.empty {
		margin-top: 34px;
	}
</style>
