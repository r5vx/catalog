<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { STATUSES, statusLabel, sortBadge } from '$lib/constants';
	import SortPicker from '$lib/SortPicker.svelte';
	import { episodesBehind } from '$lib/progress';
	import { page } from '$app/state';
	import { rememberLibrary } from '$lib/nav';
	import CategoryTabs from '$lib/CategoryTabs.svelte';
	import FillingIn from '$lib/FillingIn.svelte';
	import TagFilter from '$lib/TagFilter.svelte';
	import { p } from '$lib/poison';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const pm = $derived((data as any).poisonMode as boolean);

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

	let dismissed = $state<Set<string>>(new Set());
	const continueItems = $derived(
		(data.continueWatching ?? []).filter((w) => !dismissed.has(`${w.title}:${w.type}`))
	);

	async function removeContinue(title: string, type: string) {
		dismissed = new Set([...dismissed, `${title}:${type}`]);
		await fetch(`/api/watch/progress?title=${encodeURIComponent(title)}&type=${type}&all_episodes=1`, { method: 'DELETE' });
	}

	async function markCompleted(entryId: number | null, title: string, type: string, posterUrl?: string | null) {
		if (!entryId) {
			const categorySlug = type === 'movie' ? 'movies' : 'tv';
			const result = {
				key: `manual:${title}`, source: 'tmdb' as const, sourceId: '',
				title, altTitle: null, year: null, posterUrl: posterUrl || null,
				overview: null, categorySlug, confident: true, kind: type === 'movie' ? 'Movie' : 'TV',
				episodesTotal: null, runtimeMinutes: null, externalRating: null, externalVotes: null,
				popularity: 0
			};
			const resp = await fetch('/api/entries', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ result, status: 'completed' })
			});
			if (resp.ok) removeContinue(title, type);
			invalidateAll();
			return;
		}
		await fetch('/api/entries', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: entryId, action: 'complete' })
		});
		removeContinue(title, type);
	}

	async function markRewatched(entryId: number, title: string, type: string) {
		await fetch('/api/entries', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: entryId, action: 'rewatch' })
		});
		removeContinue(title, type);
	}

	/* --------------------------------------------------------------- watching context menu */

	let cwCtx = $state<{ x: number; y: number; item: typeof continueItems[0] } | null>(null);

	function onWatchingContext(e: MouseEvent, item: typeof continueItems[0]) {
		e.preventDefault();
		cwCtx = { x: e.clientX, y: e.clientY, item };
	}

	function closeCwCtx() { cwCtx = null; }

	function formatProgress(current: number, total: number): string {
		if (total <= 0) return 'Up next';
		const pct = Math.round((current / total) * 100);
		const left = Math.max(0, Math.floor((total - current) / 60));
		return `${pct}% · ${left}m left`;
	}

	/* --------------------------------------------------------------- context menu */

	let ctxMenu = $state<{ x: number; y: number; entry: typeof data.entries[0] } | null>(null);

	function onEntryContext(e: MouseEvent, entry: typeof data.entries[0]) {
		e.preventDefault();
		ctxMenu = { x: e.clientX, y: e.clientY, entry };
	}

	function closeCtx() { ctxMenu = null; }

	async function ctxMarkCompleted() {
		if (!ctxMenu) return;
		await fetch('/api/entries', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: ctxMenu.entry.id, action: 'complete' })
		});
		closeCtx();
		invalidateAll();
	}

	async function ctxRewatch() {
		if (!ctxMenu) return;
		await fetch('/api/entries', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: ctxMenu.entry.id, action: 'rewatch' })
		});
		closeCtx();
		invalidateAll();
	}

	async function ctxDelete() {
		if (!ctxMenu) return;
		await fetch('/api/entries', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: ctxMenu.entry.id })
		});
		closeCtx();
		invalidateAll();
	}
</script>

<header class="masthead">
	<div class="title-row">
		<h1>{pm ? p('Catalog') : 'Catalog'}</h1>
		<div class="header-actions">
			<a href="/settings" class="btn" title="Settings" aria-label="Settings">⚙</a>
			<a href="/people" class="btn">{pm ? p('Actors') : 'Actors'}</a>
			<a href="/browse" class="btn">{pm ? p('Browse') : 'Browse'}</a>
			<a href="/entry/new" class="btn btn-primary">{pm ? '+ Claim giblet' : '+ Add'}</a>
		</div>
	</div>
	<p class="muted count tabular">
		{data.total}
		{data.total === 1 ? (pm ? 'giblet' : 'entry') : (pm ? 'giblets' : 'entries')}
	</p>
</header>

<CategoryTabs
	categories={data.categories}
	countByCategory={data.countByCategory}
	total={data.total}
	noteCount={data.noteCount}
	watchingCount={continueItems.length}
	active={data.filters.cat}
	poisonMode={pm}
/>

{#if data.filters.cat === 'watching'}
	{#if continueItems.length === 0}
		<div class="empty">
			<h2>{pm ? 'hello?? nothing here' : 'Nothing here yet'}</h2>
			<p class="muted">{pm ? 'go watch a giblet and it shows up here chill' : 'Start watching something and it will appear here.'}</p>
		</div>
	{:else}
		<ul class="grid">
			{#each continueItems as item (`${item.title}:${item.type}`)}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<li class="watching-item" oncontextmenu={(e) => onWatchingContext(e, item)}>
					<a
						href="/watch?title={encodeURIComponent(item.title)}&type={item.type}&auto=1{item.type === 'tv' ? `&resume_s=${item.season}&resume_e=${item.episode}` : ''}"
						class="card"
					>
						<div class="poster">
							{#if item.posterUrl}
								<img src={item.posterUrl} alt="" loading="lazy" />
							{:else}
								<span class="poster-fallback" aria-hidden="true">▶</span>
							{/if}
							<span class="watching-progress-overlay">
								<span class="watching-fill" style="width: {item.duration > 0 ? Math.min(100, Math.round((item.currentTime / item.duration) * 100)) : 0}%"></span>
							</span>
						</div>
						<div class="meta">
							<h3 class="card-title">{item.title}</h3>
							<p class="sub faint tabular">
								{#if item.type === 'tv'}S{item.season}E{item.episode} · {/if}{formatProgress(item.currentTime, item.duration)}
							</p>
						</div>
					</a>
					<div class="watching-actions">
						{#if item.entryId && item.entryStatus === 'completed'}
							<button
								type="button"
								class="watching-action"
								title="Rewatched +1"
								onclick={() => markRewatched(item.entryId!, item.title, item.type)}
							>↻</button>
						{:else}
							<button
								type="button"
								class="watching-action"
								title="Mark completed"
								onclick={() => markCompleted(item.entryId, item.title, item.type, item.posterUrl)}
							>✓</button>
						{/if}
						<button
							type="button"
							class="watching-dismiss"
							title="Remove"
							onclick={() => removeContinue(item.title, item.type)}
						>&times;</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
{:else}
	<FillingIn />

	<div class="toolbar">
		<input
			type="search"
			id="search"
			placeholder={pm ? "find a giblet..." : "Search titles and notes…"}
			value={data.filters.q}
			oninput={onSearch}
			aria-label={pm ? "find a giblet" : "Search your library"}
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

		<SortPicker
			value={data.filters.sort}
			hidden={data.hiddenSorts}
			onchange={(next) => setParam('sort', next)}
		/>
	</div>

	{#if data.entries.length === 0}
		<div class="empty">
			{#if isFiltered}
				<h2>Nothing matches</h2>
				<p class="muted">Try a different search, or clear the filters.</p>
				<a href="/" class="btn">Clear filters</a>
			{:else}
				<h2>{pm ? "no giblets here... im hungry" : 'Your library is empty'}</h2>
				<p class="muted">{pm ? "claim your first giblet and it starts here." : "Add the first thing you've watched and it starts here."}</p>
				<a href="/entry/new" class="btn btn-primary">{pm ? '+ Claim first giblet' : '+ Add your first entry'}</a>
			{/if}
		</div>
	{:else}
		<ul class="grid">
			{#each data.entries as entry (entry.id)}
				<li oncontextmenu={(e) => onEntryContext(e, entry)}>
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
								{#if sortBadge(entry, data.filters.sort)}
									<span class="sorted tabular">{sortBadge(entry, data.filters.sort)}</span>
								{/if}
								<span class="pill {entry.status}">{pm ? p(statusLabel(entry.status)) : statusLabel(entry.status)}</span>
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
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if ctxMenu}
	<div class="ctx-backdrop" onclick={closeCtx} oncontextmenu={(e) => { e.preventDefault(); closeCtx(); }}></div>
	<div class="ctx-menu" style="left: {ctxMenu.x}px; top: {ctxMenu.y}px;">
		<button type="button" onclick={() => { const t = ctxMenu!.entry.categoryName === 'Movies' ? 'movie' : 'tv'; goto(`/watch?title=${encodeURIComponent(ctxMenu!.entry.title)}&type=${t}&auto=1`); closeCtx(); }}>
			{pm ? p('▶ Watch') : '▶ Watch'}
		</button>
		<button type="button" onclick={() => { goto(`/entry/${ctxMenu!.entry.id}?edit=1`); closeCtx(); }}>
			{pm ? p('Edit') : 'Edit'}
		</button>
		<hr />
		{#if ctxMenu.entry.status !== 'completed'}
			<button type="button" onclick={ctxMarkCompleted}>
				✓ {pm ? p('Mark completed') : 'Mark completed'}
			</button>
		{/if}
		<button type="button" onclick={ctxRewatch}>
			↻ {pm ? p('Rewatched +1') : 'Rewatched +1'}
		</button>
		<hr />
		<button type="button" class="ctx-danger" onclick={ctxDelete}>
			{pm ? p('Remove from library') : 'Remove from library'}
		</button>
	</div>
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if cwCtx}
	<div class="ctx-backdrop" onclick={closeCwCtx} oncontextmenu={(e) => { e.preventDefault(); closeCwCtx(); }}></div>
	<div class="ctx-menu" style="left: {cwCtx.x}px; top: {cwCtx.y}px;">
		<button type="button" onclick={() => { const i = cwCtx!.item; goto(`/watch?title=${encodeURIComponent(i.title)}&type=${i.type}&auto=1${i.type === 'tv' ? `&resume_s=${i.season}&resume_e=${i.episode}` : ''}`); closeCwCtx(); }}>
			▶ {pm ? p('Resume') : 'Resume'}
		</button>
		<hr />
		{#if cwCtx.item.entryId && cwCtx.item.entryStatus === 'completed'}
			<button type="button" onclick={() => { markRewatched(cwCtx!.item.entryId!, cwCtx!.item.title, cwCtx!.item.type); closeCwCtx(); }}>
				↻ {pm ? p('Rewatched +1') : 'Rewatched +1'}
			</button>
		{:else}
			<button type="button" onclick={() => { markCompleted(cwCtx!.item.entryId, cwCtx!.item.title, cwCtx!.item.type, cwCtx!.item.posterUrl); closeCwCtx(); }}>
				✓ {pm ? p('Mark completed') : 'Mark completed'}
			</button>
		{/if}
		{#if cwCtx.item.entryId}
			<button type="button" onclick={() => { goto(`/entry/${cwCtx!.item.entryId}`); closeCwCtx(); }}>
				{pm ? p('View entry') : 'View entry'}
			</button>
		{/if}
		<hr />
		<button type="button" class="ctx-danger" onclick={() => { removeContinue(cwCtx!.item.title, cwCtx!.item.type); closeCwCtx(); }}>
			{pm ? p('Remove') : 'Remove'}
		</button>
	</div>
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

	.watching-item {
		position: relative;
	}

	.watching-progress-overlay {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 4px;
		background: rgb(0 0 0 / 40%);
	}

	.watching-fill {
		display: block;
		height: 100%;
		background: var(--accent);
	}

	.watching-actions {
		position: absolute;
		top: 4px;
		right: 4px;
		display: flex;
		gap: 4px;
		z-index: 1;
		opacity: 0;
		transition: opacity 0.15s ease;
	}

	.watching-item:hover .watching-actions {
		opacity: 1;
	}

	.watching-dismiss,
	.watching-action {
		background: rgb(0 0 0 / 55%);
		border: none;
		color: #fff;
		font-size: 1rem;
		cursor: pointer;
		padding: 2px 7px;
		line-height: 1;
		border-radius: 50%;
	}

	.watching-dismiss:hover {
		background: var(--danger, #c33);
	}

	.watching-action:hover {
		background: var(--accent);
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
		background: var(--surface-2, #1e1e1e);
		border: 1px solid var(--rule, #333);
		border-radius: 8px;
		padding: 4px 0;
		box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
	}

	.ctx-menu button {
		display: block;
		width: 100%;
		padding: 8px 14px;
		border: none;
		background: none;
		color: var(--ink, #eee);
		font-size: 0.85rem;
		text-align: left;
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

	.ctx-danger {
		color: var(--danger, #c33) !important;
	}

	.ctx-danger:hover {
		background: var(--danger, #c33) !important;
		color: #fff !important;
	}
</style>
