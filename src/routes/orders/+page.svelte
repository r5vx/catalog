<script lang="ts">
	import MoreButton from '$lib/MoreButton.svelte';
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import CategoryTabs from '$lib/CategoryTabs.svelte';
	import LibraryHeader from '$lib/LibraryHeader.svelte';
	import type { PageData } from './$types';

	type Hit = { id: string; name: string; kind: 'list' | 'collection'; posterUrl: string | null; count: number | null };

	let { data }: { data: PageData } = $props();
	const pm = $derived(page.data.poisonMode);

	let adding = $state(false);
	let query = $state('');
	let hits = $state<Hit[]>([]);
	let searching = $state(false);
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	/** Removed on this visit: hidden straight away instead of waiting for the page to reload. */
	let removed = $state<string[]>([]);
	const mineIds = $derived(new Set(data.mine.map((o) => o.id).filter((id) => !removed.includes(id))));

	async function search(q: string) {
		searching = true;
		try {
			const resp = await fetch(`/api/orders?q=${encodeURIComponent(q)}`);
			if (resp.ok && q === query) hits = await resp.json();
		} catch {}
		if (q === query) searching = false;
	}

	/** Your own watch lists whose name has every word typed. */
	const words = $derived(query.toLowerCase().split(/\s+/).filter(Boolean));
	const matches = (name: string) => words.every((w) => name.toLowerCase().includes(w));

	let searchEl = $state<HTMLInputElement | null>(null);

	// One search bar: it filters your watch lists, or, while adding, finds franchises to add.
	function onQuery() {
		if (!adding) return;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => search(query), 250);
	}

	function toggleAdd() {
		adding = !adding;
		if (adding) search(query);
		searchEl?.focus();
	}

	async function add(hit: Hit) {
		await fetch('/api/orders', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: hit.id, name: hit.name })
		});
		goto(`/orders/${hit.id}`);
	}

	async function remove(id: string) {
		removed = [...removed, id];
		await fetch('/api/orders', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id })
		});
		invalidateAll();
	}

	let menu = $state<{ x: number; y: number; id: string } | null>(null);
	function onCardMenu(e: MouseEvent, id: string) {
		e.preventDefault();
		menu = { x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 100), id };
	}
</script>

<svelte:head><title>Watch list · Catalog</title></svelte:head>

<LibraryHeader
	categories={data.categories}
	countByCategory={data.countByCategory}
	total={data.total}
	completed={data.completed}
	completedByCategory={data.completedByCategory}
	poisonMode={pm}
/>

<CategoryTabs
	categories={data.categories}
	countByCategory={data.countByCategory}
	total={data.total}
	noteCount={data.noteCount}
	watchingCount={data.watchingCount}
	friendCount={data.friendCount}
	active="orders"
	poisonMode={pm}
/>

<div class="toolbar">
	<input
		type="search"
		placeholder={adding ? 'Search franchises — Marvel, Harry Potter, John Wick…' : 'Search your watch lists…'}
		aria-label={adding ? 'Search franchises to add' : 'Search your watch lists'}
		bind:this={searchEl}
		bind:value={query}
		oninput={onQuery}
	/>
	<button type="button" class="btn" class:btn-primary={!adding} onclick={toggleAdd}>
		{adding ? 'Done' : '+ Add watch list'}
	</button>
</div>

{#if adding}
	<section class="add-panel">
		{#if searching && hits.length === 0}
			<p class="muted small">{query ? 'Searching…' : 'Loading popular franchises…'}</p>
		{:else if hits.length === 0}
			<p class="muted small">Nothing found for that.</p>
		{:else}
			{#if !query}<h2 class="hits-heading">Popular</h2>{/if}
			<ul class="hits">
				{#each hits as hit (hit.id)}
					{@const mine = mineIds.has(hit.id)}
					<li>
						<button type="button" class="hit" class:mine onclick={() => (mine ? goto(`/orders/${hit.id}`) : add(hit))}>
							<div class="hit-poster">
								{#if hit.posterUrl}<img src={hit.posterUrl} alt="" loading="lazy" />{/if}
								<span class="hit-action">{mine ? 'Open' : '+ Add'}</span>
								{#if mine}<span class="hit-added">Added</span>{/if}
							</div>
							<span class="hit-name">{hit.name}</span>
							<span class="faint small">
								{hit.kind === 'list' ? 'Films and series' : 'Films'}{hit.count ? ` · ${hit.count}` : ''}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

{#if mineIds.size === 0}
	{#if !adding}
		<div class="empty">
			<h2>No watch lists yet</h2>
			<p class="muted">Add a franchise to see it in release order, and what's next.</p>
			<button type="button" class="btn btn-primary" onclick={toggleAdd}>+ Add watch list</button>
		</div>
	{/if}
{:else}
	{#await data.franchises}
		<p class="muted loading">Looking up release dates…</p>
	{:then franchises}
		{@const shown = franchises.filter((f) => mineIds.has(f.id) && (adding || matches(f.name)))}
		{#if shown.length === 0}
			<p class="muted loading">None of your watch lists match “{query.trim()}”.</p>
		{/if}
		<ul class="franchises">
			{#each shown as f (f.id)}
				<li class="has-more" oncontextmenu={(e) => onCardMenu(e, f.id)}>
					<a href="/orders/{f.id}" class="franchise">
						<div class="cover">
							{#if f.backdropUrl}
								<img src={f.backdropUrl} alt="" loading="lazy" />
							{:else}
								<div class="posters">
									{#each f.posters as poster, i (i)}
										{#if poster}<img src={poster} alt="" loading="lazy" />{/if}
									{/each}
								</div>
							{/if}
							<MoreButton onopen={(e) => onCardMenu(e, f.id)} />
							<span class="pct tabular">{f.released ? Math.round((f.watched / f.released) * 100) : 0}%</span>
						</div>
						<div class="info">
							<h2>{f.name}</h2>
							<p class="progress-text tabular"><strong>{f.watched}</strong> of {f.released} watched</p>
							<div class="bar"><div class="fill" style:width="{f.released ? (f.watched / f.released) * 100 : 0}%"></div></div>
							{#if f.upNext}
								<p class="next">
									<span class="faint">Up next</span>
									{f.upNext.title}{f.upNext.season ? ` · Season ${f.upNext.season}` : ''}
								</p>
							{:else if f.released}
								<p class="next done">All caught up</p>
							{/if}
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{:catch}
		<p class="msg bad">Couldn't look these up. Check the TMDB key in Settings → Services.</p>
	{/await}
{/if}

{#if menu}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="ctx-backdrop" onclick={() => (menu = null)} oncontextmenu={(e) => { e.preventDefault(); menu = null; }}></div>
	<div class="ctx-menu" style="left: {menu.x}px; top: {menu.y}px;">
		<button type="button" onclick={() => { goto(`/orders/${menu!.id}`); menu = null; }}>Open</button>
		<hr />
		<button type="button" class="ctx-danger" onclick={() => { remove(menu!.id); menu = null; }}>Remove watch list</button>
	</div>
{/if}

<style>
	.toolbar {
		display: flex;
		gap: 10px;
		margin-bottom: 18px;
	}

	.toolbar input {
		flex: 1;
		min-width: 0;
	}

	.toolbar .btn {
		white-space: nowrap;
	}

	.small {
		font-size: 0.82rem;
	}

	.loading {
		padding: 30px 4px;
	}

	.add-panel {
		margin-bottom: 22px;
		padding: 14px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.hits-heading {
		font-family: var(--body);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin: 4px 0 10px;
	}

	.hits {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
		gap: 16px 12px;
		max-height: 62vh;
		overflow-y: auto;
		padding: 2px;
	}

	.hit {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 0;
		border: none;
		background: none;
		color: inherit;
		text-align: left;
		font: inherit;
		cursor: pointer;
	}

	.hit-poster {
		position: relative;
		width: 100%;
		aspect-ratio: 2 / 3;
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--sunk);
		margin-bottom: 4px;
		transition: translate 0.15s, box-shadow 0.15s;
	}

	.hit:hover .hit-poster {
		translate: 0 -3px;
		box-shadow: var(--shadow);
	}

	.hit-poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	/* Appears over the poster on hover. */
	.hit-action {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgb(0 0 0 / 55%);
		color: #fff;
		font-weight: 700;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.hit:hover .hit-action,
	.hit:focus-visible .hit-action {
		opacity: 1;
	}

	.hit-added {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 3px;
		text-align: center;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		background: var(--good);
		color: var(--paper);
	}

	.hit-name {
		font-weight: 600;
		font-size: 0.86rem;
		line-height: 1.25;
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

	.franchises {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 16px;
	}

	.franchise {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		overflow: hidden;
		color: inherit;
		text-decoration: none;
		transition: border-color 0.15s, translate 0.15s, box-shadow 0.15s;
	}

	.franchise:hover {
		border-color: var(--rule-firm);
		translate: 0 -2px;
		box-shadow: var(--shadow);
	}

	.cover {
		position: relative;
		aspect-ratio: 16 / 7;
		background: var(--sunk);
		overflow: hidden;
	}

	.cover > img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center 25%;
	}

	.cover::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, transparent 45%, rgb(0 0 0 / 55%));
	}

	.pct {
		position: absolute;
		right: 10px;
		bottom: 8px;
		z-index: 1;
		color: #fff;
		font-weight: 700;
		font-size: 1.1rem;
		text-shadow: 0 1px 6px rgb(0 0 0 / 60%);
	}

	.posters {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 3px;
		height: 100%;
	}

	.posters img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.info {
		padding: 12px 14px 14px;
	}

	.info h2 {
		font-size: 1.15rem;
		margin: 0 0 4px;
	}

	.progress-text {
		margin: 0 0 6px;
		font-size: 0.85rem;
		color: var(--ink-soft);
	}

	.progress-text strong {
		color: var(--ink);
	}

	.bar {
		height: 5px;
		border-radius: 3px;
		background: var(--sunk);
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: var(--accent);
	}

	.next {
		margin: 10px 0 0;
		font-size: 0.88rem;
		font-weight: 600;
	}

	.next .faint {
		font-weight: 400;
		margin-right: 6px;
	}

	.next.done {
		color: var(--good);
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
		padding: 4px 0;
		background: var(--surface);
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}

	.ctx-menu button {
		display: block;
		width: 100%;
		padding: 8px 14px;
		border: none;
		background: none;
		color: var(--ink);
		text-align: left;
		font-size: 0.88rem;
		cursor: pointer;
	}

	.ctx-menu button:hover {
		background: var(--accent);
		color: var(--accent-ink, #fff);
	}

	.ctx-menu hr {
		border: none;
		border-top: 1px solid var(--rule);
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
