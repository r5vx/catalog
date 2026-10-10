<script lang="ts">
	import MoreButton from '$lib/MoreButton.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import BackBar from '$lib/BackBar.svelte';
	import { p, pRandom } from '$lib/poison';
	import type { SearchResult } from '$lib/server/metadata/types';
	import { titleKey } from '$lib/titleKey';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const pm = $derived(page.data.poisonMode);

	const TABS = [
		{ value: '', label: 'Everything' },
		{ value: 'movies', label: 'Films' },
		{ value: 'tv', label: 'TV Series' },
		{ value: 'anime', label: 'Anime' },
		{ value: 'actors', label: 'Actors' }
	];

	const MODES = [
		{ value: 'trending', label: 'Trending now' },
		{ value: 'popular', label: 'All time' }
	];

	const SORTS = [
		{ value: '', label: 'Most voted' },
		{ value: 'vote_average', label: 'Highest rated' },
		{ value: 'popularity', label: 'Most popular' },
		{ value: 'release_date_desc', label: 'Newest first' },
		{ value: 'release_date_asc', label: 'Oldest first' }
	];

	const GENRES = [
		{ value: '', label: 'Any genre' },
		{ value: '28', label: 'Action' },
		{ value: '12', label: 'Adventure' },
		{ value: '16', label: 'Animation' },
		{ value: '35', label: 'Comedy' },
		{ value: '80', label: 'Crime' },
		{ value: '99', label: 'Documentary' },
		{ value: '18', label: 'Drama' },
		{ value: '10751', label: 'Family' },
		{ value: '14', label: 'Fantasy' },
		{ value: '36', label: 'History' },
		{ value: '27', label: 'Horror' },
		{ value: '9648', label: 'Mystery' },
		{ value: '10749', label: 'Romance' },
		{ value: '878', label: 'Sci-Fi' },
		{ value: '53', label: 'Thriller' },
		{ value: '10752', label: 'War' },
		{ value: '37', label: 'Western' }
	];

	/** Filters live in the URL, so a search you liked is a link you can keep. */
	function setParam(key: string, value: string) {
		const params = new URLSearchParams(window.location.search);
		if (value) params.set(key, value);
		else params.delete(key);
		goto(`?${params.toString()}`, { keepFocus: true, noScroll: true });
	}

	function setParams(pairs: Record<string, string>) {
		const params = new URLSearchParams(window.location.search);
		for (const [k, v] of Object.entries(pairs)) {
			if (v) params.set(k, v);
			else params.delete(k);
		}
		goto(`?${params.toString()}`, { keepFocus: true, noScroll: true });
	}

	let yearFromInput = $state(data.yearFrom ? String(data.yearFrom) : '');
	let yearToInput = $state(data.yearTo ? String(data.yearTo) : '');
	let browseFilterOpen = $state(false);
	let browseFilterPanel = $state<HTMLDivElement | null>(null);

	function applyYears() {
		setParams({ from: yearFromInput, to: yearToInput });
	}

	const browseFilterCount = $derived((data.genre ? 1 : 0) + (data.yearFrom || data.yearTo ? 1 : 0));

	function onBrowseFilterClick(e: MouseEvent) {
		if (browseFilterPanel && !browseFilterPanel.contains(e.target as Node)) browseFilterOpen = false;
	}

	// eslint-disable-next-line svelte/valid-compile -- intentionally captures initial data.q only
	let searchText = $state(data.q ?? '');
	let typing: ReturnType<typeof setTimeout>;
	function onSearch() {
		clearTimeout(typing);
		typing = setTimeout(() => setParam('q', searchText), 350);
	}

	/* ------------------------------------------------- what you already have */

	const owned = $derived(data.owned as Record<string, number>);
	const posters = $derived((data.posters ?? {}) as Record<number, string>);
	const keyOf = (result: SearchResult) => `${result.source}:${result.sourceId}`;
	/** In the library from the other site (an AniList result for a TMDB entry): same title and year. */
	const ownedByTitle = (result: SearchResult) => (result.year ? owned[titleKey(result.title, result.year)] : undefined);

	/** Added during this visit — the page doesn't reload, so it tracks its own. */
	let justAdded = $state<Record<string, number>>({});
	let justRemoved = $state<Set<string>>(new Set());
	let busy = $state<string | null>(null);
	let problem = $state('');

	const have = (result: SearchResult) => {
		const k = keyOf(result);
		if (justRemoved.has(k)) return false;
		return k in owned || k in justAdded || ownedByTitle(result) !== undefined;
	};

	/** In the library: its poster there, so the two match. */
	function posterOf(result: SearchResult): string | null {
		const id = entryIdOf(result);
		return (id && posters[id]) || result.posterUrl || null;
	}

	function entryIdOf(result: SearchResult): number | null {
		const k = keyOf(result);
		return justAdded[k] ?? owned[k] ?? ownedByTitle(result) ?? null;
	}

	async function remove(result: SearchResult) {
		const id = entryIdOf(result);
		if (!id) return;
		try {
			await fetch('/api/entries', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			justRemoved = new Set([...justRemoved, keyOf(result)]);
		} catch {}
	}

	let ctxMenu = $state<{ x: number; y: number; result: SearchResult } | null>(null);

	function onCardContext(e: MouseEvent, result: SearchResult) {
		e.preventDefault();
		const menuW = 200;
		const menuH = 220;
		const x = Math.min(e.clientX, window.innerWidth - menuW);
		const y = Math.min(e.clientY, window.innerHeight - menuH);
		ctxMenu = { x, y, result };
	}

	function closeCtx() { ctxMenu = null; }

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
		const signature = `${data.cat}:${data.mode}:${data.sort}:${data.yearFrom}:${data.yearTo}:${data.genre}`;
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
		const PAGES_PER_CLICK = 3;
		const MAX_EMPTY = shelf.key === 'anime' ? 3 : 1;

		try {
			let currentPage = at[shelf.key] ?? shelf.page;
			let allFresh: SearchResult[] = [];
			const already = new Set(shelfResults(shelf).map((one) => one.key));
			let emptyRun = 0;
			let mode = data.mode;

			for (let i = 0; i < PAGES_PER_CLICK + MAX_EMPTY; i++) {
				const next = currentPage + 1;
				let moreUrl = `/api/browse?cat=${shelf.key}&mode=${mode}&page=${next}`;
					if (data.sort) moreUrl += `&sort=${data.sort}`;
					if (data.yearFrom) moreUrl += `&from=${data.yearFrom}`;
					if (data.yearTo) moreUrl += `&to=${data.yearTo}`;
					if (data.genre) moreUrl += `&genre=${data.genre}`;
					const response = await fetch(moreUrl);

				if (!response.ok) break;

				const payload = await response.json();
				const results: SearchResult[] = payload.results ?? [];
				const fresh = results.filter((one) => {
					if (already.has(one.key)) return false;
					already.add(one.key);
					return true;
				});

				if (fresh.length === 0) {
					emptyRun++;
					if (emptyRun >= MAX_EMPTY) {
						if (shelf.key === 'anime' && mode === 'trending' && !data.sort) {
							mode = 'popular';
							emptyRun = 0;
							continue;
						}
						ended = { ...ended, [shelf.key]: true };
						break;
					}
					currentPage = next;
					continue;
				}

				emptyRun = 0;
				allFresh = [...allFresh, ...fresh];
				currentPage = next;
				if (allFresh.length >= PAGES_PER_CLICK * 50) break;
			}

			if (allFresh.length > 0) {
				extra = { ...extra, [shelf.key]: [...(extra[shelf.key] ?? []), ...allFresh] };
				at = { ...at, [shelf.key]: currentPage };
			} else if (!ended[shelf.key]) {
				ended = { ...ended, [shelf.key]: true };
			}
		} catch {
			ended = { ...ended, [shelf.key]: true };
		} finally {
			loading = null;
		}
	}

	/** Where "back" should return to, including whatever you searched for. */
	const here = $derived(`/browse${page.url.search}`);

	let showBackToTop = $state(false);

	function onScroll() {
		showBackToTop = window.scrollY > 600;
	}

	function scrollToTop() {
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	$effect(() => {
		window.addEventListener('scroll', onScroll, { passive: true });
		const saved = sessionStorage.getItem('browse-scroll');
		const savedExtra = sessionStorage.getItem('browse-extra');
		if (savedExtra) {
			try {
				const parsed = JSON.parse(savedExtra);
				extra = parsed.extra ?? {};
				at = parsed.at ?? {};
				ended = parsed.ended ?? {};
			} catch {}
			sessionStorage.removeItem('browse-extra');
		}
		if (saved) {
			const y = Number(saved);
			sessionStorage.removeItem('browse-scroll');
			requestAnimationFrame(() => {
				requestAnimationFrame(() => window.scrollTo(0, y));
			});
		}
		return () => window.removeEventListener('scroll', onScroll);
	});

	function saveScroll() {
		try {
			sessionStorage.setItem('browse-scroll', String(window.scrollY));
			if (Object.keys(extra).length > 0) {
				sessionStorage.setItem('browse-extra', JSON.stringify({ extra, at, ended }));
			}
		} catch {}
	}

	const link = (result: SearchResult) =>
		`/title/${result.source}/${encodeURIComponent(result.sourceId)}?back=${encodeURIComponent(here)}`;
</script>

<svelte:window onmousedown={onBrowseFilterClick} onkeydown={(e) => e.key === 'Escape' && (browseFilterOpen = false)} />
<svelte:head><title>{pm ? 'Find giblets' : 'Browse'} · {pm ? "Papa's Giblets" : 'Catalog'}</title></svelte:head>

<BackBar />

<header class="masthead">
	<h1>{pm ? 'Find giblets' : 'Browse everything'}</h1>
	<p class="muted">
		{pm ? 'All the giblets the databases know about — are we deadass rn.' : 'Every film, series and anime the databases know about — not only what you\'ve added.'}
	</p>
</header>

<div class="toolbar">
	<input
		type="search"
		placeholder={data.cat === 'actors' ? (pm ? "find a baddie..." : "Search actors…") : (pm ? "find a giblet..." : "Search for anything…")}
		bind:value={searchText}
		oninput={onSearch}
		aria-label={data.cat === 'actors' ? "Search actors" : "Search every title"}
	/>
</div>

<nav class="tabs">
	{#each TABS as tab (tab.value)}
		<button
			type="button"
			class:active={data.cat === tab.value}
			onclick={() => setParam('cat', tab.value)}
		>
			{pm ? p(tab.label) : tab.label}
		</button>
	{/each}

	{#if !data.q && data.cat !== 'actors'}
		<span class="modes">
			{#each MODES as option (option.value)}
				<button
					type="button"
					class="mode"
					class:active={data.mode === option.value}
					onclick={() => setParam('mode', option.value === 'trending' ? '' : option.value)}
				>
					{pm ? p(option.label) : option.label}
				</button>
			{/each}
		</span>
	{/if}
</nav>

{#if !data.q && data.cat !== 'actors'}
	<div class="browse-toolbar">
		<select
			aria-label="Sort by"
			onchange={(e) => setParam('sort', (e.target as HTMLSelectElement).value)}
		>
			{#each SORTS as opt (opt.value)}
				<option value={opt.value} selected={data.sort === opt.value || (!data.sort && !opt.value)}>{opt.label}</option>
			{/each}
		</select>

		<div class="browse-filter-wrap" bind:this={browseFilterPanel}>
			<button
				type="button"
				class="btn browse-filter-trigger"
				class:on={browseFilterCount > 0}
				aria-expanded={browseFilterOpen}
				onclick={(e) => { e.stopPropagation(); browseFilterOpen = !browseFilterOpen; }}
			>
				{browseFilterCount > 0 ? `${browseFilterCount} filter${browseFilterCount === 1 ? '' : 's'}` : 'Filter'}
				<span class="caret" aria-hidden="true">▾</span>
			</button>

			{#if browseFilterOpen}
				<div class="browse-filter-panel">
					<label class="browse-filter-label">Genre</label>
					<select
						aria-label="Genre"
						onchange={(e) => setParam('genre', (e.target as HTMLSelectElement).value)}
					>
						{#each GENRES as opt (opt.value)}
							<option value={opt.value} selected={String(data.genre ?? '') === opt.value}>{opt.label}</option>
						{/each}
					</select>

					<label class="browse-filter-label">Year range</label>
					<div class="browse-year-row">
						<input type="number" min="1900" max="2030" placeholder="From" aria-label="From year" bind:value={yearFromInput} onchange={applyYears} />
						<span class="browse-year-dash">–</span>
						<input type="number" min="1900" max="2030" placeholder="To" aria-label="To year" bind:value={yearToInput} onchange={applyYears} />
					</div>

					{#if browseFilterCount > 0}
						<button type="button" class="browse-filter-clear" onclick={() => { setParams({ genre: '', from: '', to: '' }); yearFromInput = ''; yearToInput = ''; }}>
							Clear all
						</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

{#if !data.tmdbEnabled}
	<p class="msg" role="status">
		Without a TMDB key this only finds anime. <a href="/settings/services">Add one</a> and films
		and series appear here too.
	</p>
{/if}

{#if problem}
	<p class="msg bad" role="alert">{problem}</p>
{/if}

{#if data.cat === 'actors'}
	{#if data.q && data.q.length >= 2 && data.people.length === 0}
		<p class="muted actor-none">No one by that name in your library.</p>
	{/if}

	<ul class="actor-list">
		{#each data.people as person (person.id)}
			<li>
				<a href="/person/{person.id}">
					{#if person.photo}
						<img src={person.photo} alt="" loading="lazy" />
					{:else}
						<span class="noface" aria-hidden="true">?</span>
					{/if}
					<span class="actor-who">
						<span class="actor-name">{person.name}</span>
						<span class="faint small tabular">
							{person.count}
							{person.count === 1 ? 'title' : 'titles'} · {person.sample}
						</span>
					</span>
				</a>
			</li>
		{/each}
	</ul>

	{#if !data.q && data.trending.length > 0}
		<section class="trending">
			<h2 class="trending-label">{pm ? "alpha baddies rn" : 'Trending this week'}</h2>
			<ul class="trend-grid">
				{#each data.trending as person (person.id)}
					<li>
						<a href="/person/tmdb:{person.id}">
							<div class="trend-photo">
								<img src={person.photo} alt="" loading="lazy" />
							</div>
							<span class="trend-name">{person.name}</span>
							{#if person.knownFor}
								<span class="trend-known faint">{person.knownFor}</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
{/if}

{#snippet card(result: SearchResult)}
	<li class="card has-more" class:mine={have(result)} oncontextmenu={(e) => onCardContext(e, result)}>
		<a href={link(result)} class="card-link" aria-label={result.title} onclick={saveScroll}></a>
		<div class="poster">
			{#if posterOf(result)}
				<img src={posterOf(result)} alt="" loading="lazy" />
			{:else}
				<span class="fallback" aria-hidden="true">?</span>
			{/if}
			{#if have(result)}<span class="tick" title="In your library">&check;</span>{/if}
			<MoreButton onopen={(e) => onCardContext(e, result)} top={have(result) ? 36 : 6} />
			{#if have(result)}
				<button type="button" class="hover-remove" title="Remove from library" onclick={(e) => { e.preventDefault(); e.stopPropagation(); remove(result); }}>&times;</button>
			{:else}
				<span class="hover-actions">
					<button type="button" title="Add as completed" onclick={(e) => { e.stopPropagation(); add(result, 'completed'); }}>+ Add</button>
					<button type="button" title="Add to watchlist" onclick={(e) => { e.stopPropagation(); add(result, 'planned'); }}>♡ Watchlist</button>
				</span>
			{/if}
		</div>

		<span class="name">{result.title}</span>

		<p class="sub faint tabular">
			{result.year ?? '—'} · {result.kind}{#if result.externalRating}&nbsp;· {result.externalRating.toFixed(
					1
				)}{/if}
		</p>

		{#if result.overview}
			<p class="blurb">{result.overview}</p>
		{/if}

		{#if justAdded[keyOf(result)]}
			<a class="added" href="/entry/{justAdded[keyOf(result)]}">{pm ? 'Claimed →' : 'Added →'}</a>
		{:else if have(result)}
			<span class="added">{pm ? p('In your library') : 'In your library'}</span>
		{/if}
	</li>
{/snippet}

{#if data.cat !== 'actors'}
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
				<h2>{pm ? p(shelf.label) : shelf.label}</h2>
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
						{loading === shelf.key ? (pm ? pRandom() : 'Finding more…') : (pm ? 'gimme more giblets' : 'Show more')}
					</button>
				{/if}
			</section>
		{/each}
	{/if}
{/if}

{#if showBackToTop}
	<button type="button" class="back-to-top" onclick={scrollToTop}>↑ Back to top</button>
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if ctxMenu}
	<div class="ctx-backdrop" onclick={closeCtx} oncontextmenu={(e) => { e.preventDefault(); closeCtx(); }}></div>
	<div class="ctx-menu" style="left: {ctxMenu.x}px; top: {ctxMenu.y}px;">
		<button type="button" onclick={() => {
			const r = ctxMenu!.result;
			const t = r.kind === 'Movie' || r.sourceId.startsWith('movie:') ? 'movie' : 'tv';
			goto(`/watch?title=${encodeURIComponent(r.title)}&type=${t}${r.year ? `&year=${r.year}` : ''}&auto=1`);
			closeCtx();
		}}>
			{pm ? p('▶ Watch') : '▶ Watch'}
		</button>
		<button type="button" onclick={() => { goto(link(ctxMenu!.result)); closeCtx(); }}>
			{pm ? p('View details') : 'View details'}
		</button>
		<hr />
		{#if have(ctxMenu.result)}
			{#if entryIdOf(ctxMenu.result)}
				<button type="button" onclick={() => { goto(`/entry/${entryIdOf(ctxMenu!.result)}`); closeCtx(); }}>
					{pm ? p('View entry') : 'View entry'}
				</button>
			{/if}
			<hr />
			<button type="button" class="ctx-danger" onclick={() => { remove(ctxMenu!.result); closeCtx(); }}>
				{pm ? p('Remove from library') : 'Remove from library'}
			</button>
		{:else}
			<button type="button" onclick={() => { add(ctxMenu!.result, 'completed'); closeCtx(); }}>
				✓ {pm ? p('Add as completed') : 'Add as completed'}
			</button>
			<button type="button" onclick={() => { add(ctxMenu!.result, 'watching'); closeCtx(); }}>
				{pm ? p('Add as watching') : 'Add as watching'}
			</button>
			<button type="button" onclick={() => { add(ctxMenu!.result, 'planned'); closeCtx(); }}>
				{pm ? p('Add to watchlist') : 'Add to watchlist'}
			</button>
		{/if}
	</div>
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

	.browse-toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-bottom: 18px;
	}

	.browse-toolbar select {
		width: auto;
		min-width: 130px;
		max-width: 220px;
	}

	.browse-filter-wrap {
		position: relative;
	}

	.browse-filter-trigger {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}

	.browse-filter-trigger.on {
		border-color: var(--accent);
		color: var(--accent);
	}

	.caret {
		font-size: 0.7rem;
		opacity: 0.7;
	}

	.browse-filter-panel {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 20;
		width: 260px;
		max-width: calc(100vw - 32px);
		background: var(--surface);
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.browse-filter-panel select {
		width: 100%;
		min-width: 0;
		max-width: none;
	}

	.browse-filter-label {
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--ink-soft);
		margin: 0;
	}

	.browse-year-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.browse-year-row input {
		flex: 1;
		min-width: 0;
		font-size: 0.85rem;
		padding: 6px 8px;
	}

	.browse-year-dash {
		color: var(--ink-soft);
		font-size: 0.85rem;
	}

	.browse-filter-clear {
		background: none;
		border: none;
		border-top: 1px solid var(--rule);
		padding: 8px 0 0;
		color: var(--accent);
		font-size: 0.83rem;
		text-align: left;
		cursor: pointer;
	}

	@media (max-width: 560px) {
		.browse-toolbar select {
			flex: 1;
			min-width: 0;
		}
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

	.card {
		position: relative;
	}

	.card-link {
		position: absolute;
		inset: 0;
		z-index: 1;
	}

	.card .added {
		position: relative;
		z-index: 2;
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

	.card:hover .poster {
		border-color: var(--accent);
	}

	.hover-actions {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		gap: 4px;
		padding: 6px;
		background: linear-gradient(transparent, rgba(0, 0, 0, 0.85));
		z-index: 3;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.card:hover .hover-actions {
		opacity: 1;
	}

	.hover-actions button {
		flex: 1;
		padding: 5px 4px;
		border: none;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.18);
		color: #fff;
		font-size: 0.7rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}

	.hover-actions button:hover {
		background: var(--accent);
		color: var(--accent-ink);
	}

	.hover-remove {
		position: absolute;
		top: 6px;
		left: 6px;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: none;
		background: rgba(0,0,0,0.65);
		color: #fff;
		font-size: 1.1rem;
		line-height: 1;
		display: grid;
		place-items: center;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.12s ease;
		z-index: 2;
	}

	.card:hover .hover-remove { opacity: 1; }
	.hover-remove:hover { background: var(--danger, #c33); }

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

	.card:hover .name {
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

	.back-to-top {
		position: fixed;
		bottom: 28px;
		right: 28px;
		z-index: 50;
		padding: 10px 18px;
		border-radius: 100px;
		border: 1px solid var(--rule);
		background: var(--surface);
		color: var(--ink);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
		display: flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}

	.back-to-top:hover {
		background: var(--accent);
		color: var(--accent-ink);
		border-color: var(--accent);
	}

	.ctx-backdrop {
		position: fixed;
		inset: 0;
		z-index: 900;
	}

	.ctx-menu {
		position: fixed;
		z-index: 901;
		min-width: 180px;
		background: var(--surface, #1e1e1e);
		border: 1px solid var(--rule, #333);
		border-radius: var(--radius-sm, 6px);
		padding: 4px 0;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}

	.ctx-menu button {
		display: block;
		width: 100%;
		padding: 8px 14px;
		border: none;
		background: none;
		color: var(--ink, #ddd);
		text-align: left;
		font-size: 0.84rem;
		cursor: pointer;
	}

	.ctx-menu button:hover {
		background: var(--accent);
		color: var(--accent-ink, #fff);
	}

	.ctx-menu hr {
		border: none;
		border-top: 1px solid var(--rule, #333);
		margin: 4px 0;
	}

	.ctx-info {
		display: block;
		padding: 8px 14px;
		font-size: 0.84rem;
		color: var(--good);
		font-weight: 600;
	}

	.ctx-danger { color: var(--danger, #c33) !important; }
	.ctx-danger:hover { background: var(--danger, #c33) !important; color: #fff !important; }

	/* ---- Actors tab ---- */

	.actor-none {
		font-size: 0.9rem;
		margin: 16px 0 0;
	}

	.actor-list {
		list-style: none;
		margin: 18px 0 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 4px 16px;
	}

	.actor-list a {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px;
		border-radius: var(--radius-sm);
	}

	.actor-list a:hover {
		background: var(--surface);
	}

	.actor-list img,
	.noface {
		width: 46px;
		height: 46px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid var(--rule);
		flex-shrink: 0;
	}

	.noface {
		display: grid;
		place-items: center;
		background: var(--surface-2);
		color: var(--ink-faint);
	}

	.actor-who {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.actor-name {
		font-weight: 600;
		font-size: 0.93rem;
	}

	.small {
		font-size: 0.76rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.trending {
		margin-top: 32px;
	}

	.trending-label {
		font-family: var(--body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin: 0;
	}

	.trend-grid {
		list-style: none;
		margin: 14px 0 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 18px 14px;
	}

	.trend-grid a {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		text-align: center;
		border-radius: var(--radius);
		padding: 8px 4px;
	}

	.trend-grid a:hover {
		background: var(--surface);
	}

	.trend-photo {
		width: 90px;
		height: 90px;
		border-radius: 50%;
		overflow: hidden;
		border: 2px solid var(--rule);
	}

	.trend-photo img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.trend-name {
		font-weight: 600;
		font-size: 0.88rem;
	}

	.trend-known {
		font-size: 0.74rem;
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
