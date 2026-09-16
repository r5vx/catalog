<script lang="ts">
	import { goto } from '$app/navigation';
	import { STATUSES, statusLabel, sortBadge } from '$lib/constants';
	import SortPicker from '$lib/SortPicker.svelte';
	import { episodesBehind } from '$lib/progress';
	import { page } from '$app/state';
	import { rememberLibrary } from '$lib/nav';
	import CategoryTabs from '$lib/CategoryTabs.svelte';
	import TagFilter from '$lib/TagFilter.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The current filters live in the URL, so every view you land on is a link
	// you can bookmark or send to yourself.
	function setParam(key: string, value: string) {
		const params = new URLSearchParams(window.location.search);
		if (value) params.set(key, value);
		else params.delete(key);
		goto(`?${params.toString()}`, { keepFocus: true, noScroll: true });
	}

	/** Tag filters are multi-value, so they replace all `tag` params at once. */
	function setTags(ids: number[]) {
		const params = new URLSearchParams(window.location.search);
		params.delete('tag');
		for (const id of ids) params.append('tag', String(id));
		goto(`?${params.toString()}`, { keepFocus: true, noScroll: true });
	}

	let searchTimer: ReturnType<typeof setTimeout>;
	function onSearch(event: Event) {
		clearTimeout(searchTimer);
		const value = (event.target as HTMLInputElement).value;
		searchTimer = setTimeout(() => setParam('q', value), 200);
	}

	// Keep the current view so other pages can send you back to it.
	$effect(() => {
		rememberLibrary(page.url.search);
	});

	const isFiltered = $derived(
		Boolean(data.filters.q || data.filters.cat || data.filters.status || data.filters.tags.length > 0)
	);
</script>

<header class="masthead">
	<div class="title-row">
		<h1>Catalog</h1>
		<div class="header-actions">
			<a href="/settings" class="btn" title="Settings" aria-label="Settings">⚙</a>
			<a href="/people" class="btn">Actors</a>
			<a href="/import" class="btn">Bulk add</a>
			<a href="/entry/new" class="btn btn-primary">+ Add</a>
		</div>
	</div>
	<p class="muted count tabular">
		{data.total}
		{data.total === 1 ? 'entry' : 'entries'}
	</p>
</header>

<CategoryTabs
	categories={data.categories}
	countByCategory={data.countByCategory}
	total={data.total}
	noteCount={data.noteCount}
	active={data.filters.cat}
/>

<div class="toolbar">
	<input
		type="search"
		id="search"
		placeholder="Search titles and notes…"
		value={data.filters.q}
		oninput={onSearch}
		aria-label="Search your library"
	/>

	{#if data.tags.length > 0}
		<TagFilter tags={data.tags} selected={data.filters.tags} onchange={setTags} />
	{/if}

	<select
		id="status"
		aria-label="Filter by status"
		value={data.filters.status}
		onchange={(e) => setParam('status', e.currentTarget.value)}
	>
		<option value="">Any status</option>
		{#each STATUSES as status (status.value)}
			<option value={status.value}>{status.label}</option>
		{/each}
	</select>

	<SortPicker value={data.filters.sort} onchange={(next) => setParam('sort', next)} />
</div>

{#if data.entries.length === 0}
	<div class="empty">
		{#if isFiltered}
			<h2>Nothing matches</h2>
			<p class="muted">Try a different search, or clear the filters.</p>
			<a href="/" class="btn">Clear filters</a>
		{:else}
			<h2>Your library is empty</h2>
			<p class="muted">Add the first thing you've watched and it starts here.</p>
			<a href="/entry/new" class="btn btn-primary">+ Add your first entry</a>
		{/if}
	</div>
{:else}
	<ul class="grid">
		{#each data.entries as entry (entry.id)}
			<li>
				<a href="/entry/{entry.id}" class="card">
					<div class="poster">
						{#if entry.posterUrl}
							<img src={entry.posterUrl} alt="" loading="lazy" />
						{:else}
							<span class="poster-fallback" aria-hidden="true">{entry.categoryEmoji}</span>
						{/if}
						{#if entry.favorite}
							<span class="fav" title="Favourite" aria-label="Favourite">★</span>
						{/if}
					</div>

					<div class="meta">
						<h3 class="card-title">{entry.title}</h3>
						<p class="sub faint tabular">
							{entry.year ?? '—'} · {entry.categoryName}
						</p>
						<div class="badges">
							<!-- Whatever you sorted on, shown without opening the title. -->
							{#if sortBadge(entry, data.filters.sort)}
								<span class="sorted tabular">{sortBadge(entry, data.filters.sort)}</span>
							{/if}
							<span class="pill {entry.status}">{statusLabel(entry.status)}</span>
							{#if entry.rating !== null}
								<span class="rating mine tabular" title="Your rating">{entry.rating.toFixed(1)}</span>
							{:else if entry.externalRating !== null}
								<span class="rating tabular" title="Public rating"
									>{entry.externalRating.toFixed(1)}</span
								>
							{/if}
							{#if episodesBehind(entry)}
								<span class="waiting tabular" title="Episodes you have not seen">
									+{episodesBehind(entry)}
								</span>
							{/if}
							{#if entry.lastSeason !== null || entry.lastEpisode !== null}
								<span class="rating tabular" title="Where you left off">
									{entry.lastSeason !== null ? `S${entry.lastSeason}` : ''}{entry.lastEpisode !==
									null
										? `E${entry.lastEpisode}`
										: ''}
								</span>
							{/if}
							{#if entry.rewatches > 0}
								<span class="rewatch tabular" title="Times rewatched">
									×{entry.rewatches + 1}
								</span>
							{/if}
						</div>
					</div>
				</a>
			</li>
		{/each}
	</ul>
{/if}

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

	.count {
		font-size: 0.85rem;
	}






	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-bottom: 24px;
	}

	.toolbar input {
		flex: 1 1 220px;
		min-width: 0;
	}

	.toolbar select {
		width: auto;
		min-width: 130px;
		max-width: 220px;
	}

	@media (max-width: 560px) {
		.toolbar input {
			flex-basis: 100%;
		}
		.toolbar select {
			flex: 1;
			min-width: 0;
		}
	}

	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(155px, 1fr));
		gap: 20px 16px;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 9px;
	}

	.poster {
		position: relative;
		aspect-ratio: 2 / 3;
		max-width: 100%;
		background: var(--surface-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		overflow: hidden;
		display: grid;
		place-items: center;
		transition:
			border-color 0.14s ease,
			transform 0.14s ease;
	}

	.card:hover .poster {
		border-color: var(--accent);
		transform: translateY(-2px);
	}

	.poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.poster-fallback {
		font-size: 2rem;
		opacity: 0.4;
	}

	.fav {
		position: absolute;
		top: 6px;
		right: 7px;
		color: var(--warn);
		font-size: 1rem;
		text-shadow: 0 1px 3px rgb(0 0 0 / 45%);
	}

	.meta {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.card-title {
		font-family: var(--body);
		font-size: 0.92rem;
		font-weight: 600;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}

	.sub {
		font-size: 0.78rem;
		margin: 0;
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 5px;
		margin-top: 2px;
	}

	.waiting {
		font-size: 0.72rem;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: var(--good-bg);
		color: var(--good);
		border: 1px solid var(--good);
	}

	.rating.mine {
		background: var(--accent-bg);
		color: var(--accent);
		border-color: var(--accent);
	}

	.rating,
	.rewatch,
	.sorted {
		font-size: 0.72rem;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: var(--sunk);
		color: var(--ink-soft);
		border: 1px solid var(--rule);
	}

	/* The value you sorted on leads, so the column reads down the page. */
	.sorted {
		background: var(--accent-bg);
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 35%, transparent);
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		text-align: center;
		padding: 72px 20px;
		border: 1px dashed var(--rule-firm);
		border-radius: var(--radius);
	}

	.empty h2 {
		font-size: 1.3rem;
	}

	.empty .btn {
		margin-top: 8px;
	}
</style>
