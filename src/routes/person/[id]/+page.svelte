<script lang="ts">
	import MoreButton from '$lib/MoreButton.svelte';
	import { goto } from '$app/navigation';
	import BackBar from '$lib/BackBar.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Our own id where this person is in the library, the provider's if not. */
	const personKey = $derived(data.person.id || data.person.sourceId);
	const here = $derived(`/person/${personKey}`);

	/** Titles added from here, so the button can show it worked. */
	let justAdded = $state<Record<string, number>>({});
	let adding = $state<string | null>(null);

	type Credit = {
		title: string;
		year: string;
		poster: string | null;
		source: string;
		sourceId: string;
		kind: string;
		categorySlug: string;
		rating: number | null;
		votes: number | null;
	};

	async function addToWatchlist(credit: Credit, status: 'planned' | 'watching' | 'completed' = 'planned') {
		const key = `${credit.source}:${credit.sourceId}`;
		adding = key;

		try {
			const response = await fetch('/api/entries', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					result: {
						key,
						source: credit.source,
						sourceId: credit.sourceId,
						title: credit.title,
						altTitle: null,
						year: Number(credit.year) || null,
						posterUrl: credit.poster,
						overview: null,
						categorySlug: credit.categorySlug,
						confident: true,
						kind: credit.kind,
						episodesTotal: null,
						runtimeMinutes: null,
						externalRating: credit.rating,
						externalVotes: credit.votes,
						popularity: 0
					},
					// From the + button, something you haven't seen goes on the list, not into history.
					status,
					markWatchedToday: status === 'completed'
				})
			});

			if (response.ok) justAdded[key] = (await response.json()).id;
		} finally {
			adding = null;
		}
	}

	/* ------------------------------------------------ right-click menu */

	let menu = $state<{ x: number; y: number; credit: Credit } | null>(null);

	function openMenu(e: MouseEvent, credit: Credit) {
		e.preventDefault();
		menu = { x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 230), credit };
	}

	function watch(credit: Credit) {
		menu = null;
		const params = new URLSearchParams({ title: credit.title, type: credit.categorySlug === 'movies' ? 'movie' : 'tv', auto: '1' });
		if (credit.year) params.set('year', credit.year);
		goto(`/watch?${params}`);
	}

	/** Your own entries this person is in: watch or open. */
	type Owned = (typeof data.entries)[number];
	let ownedMenu = $state<{ x: number; y: number; item: Owned } | null>(null);

	function openOwnedMenu(e: MouseEvent, item: Owned) {
		e.preventDefault();
		ownedMenu = { x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 110), item };
	}

	function watchOwned(item: Owned) {
		ownedMenu = null;
		const params = new URLSearchParams({ title: item.title, type: item.categorySlug === 'movies' ? 'movie' : 'tv', auto: '1' });
		if (item.year) params.set('year', String(item.year));
		goto(`/watch?${params}`);
	}

	function addAs(credit: Credit, status: 'planned' | 'watching' | 'completed') {
		menu = null;
		addToWatchlist(credit, status);
	}

	const PAGE = 20;
	let showing = $state(PAGE);

	const visible = $derived(data.knownFor.slice(0, showing));
	const remaining = $derived(data.knownFor.length - visible.length);
</script>

<svelte:head><title>{data.person.name} · Catalog</title></svelte:head>

<BackBar href={data.back} />

<header>
	{#if data.person.photo}
		<img class="portrait" src={data.person.photo} alt="" />
	{:else}
		<div class="portrait empty" aria-hidden="true">?</div>
	{/if}
	<div>
		<h1>{data.person.name}</h1>
		{#if data.entries.length > 0}
			<p class="muted tabular">
				In {data.entries.length}
				{data.entries.length === 1 ? 'title' : 'titles'} you've watched
			</p>
		{:else}
			<p class="muted">Nothing of theirs in your library yet.</p>
		{/if}
	</div>
</header>

<ul class="grid">
	{#each data.entries as item (item.id)}
		<li class="has-more owned" oncontextmenu={(e) => openOwnedMenu(e, item)}>
			<MoreButton onopen={(e) => openOwnedMenu(e, item)} />
			<a href="/entry/{item.id}" class="card">
				<div class="poster">
					{#if item.posterUrl}
						<img src={item.posterUrl} alt="" loading="lazy" />
					{:else}
						<span class="fallback" aria-hidden="true">{item.categoryEmoji}</span>
					{/if}
				</div>
				<h2 class="name">{item.title}</h2>
				<p class="sub faint tabular">{item.year ?? '—'}</p>
				{#if item.character}
					<p class="role faint">as {item.character}</p>
				{/if}
			</a>
		</li>
	{/each}
</ul>

{#if data.knownFor.length > 0}
	<section class="known">
		<h2>Also known for</h2>
		<p class="muted small">Not in your library.</p>

		<ul class="grid">
			{#each visible as credit (credit.title + credit.year)}
				{@const key = `${credit.source}:${credit.sourceId}`}
				<li class="has-more" oncontextmenu={(e) => openMenu(e, credit)}>
					<MoreButton corner="left" onopen={(e) => openMenu(e, credit)} />
					<!-- Read about it first; the + adds it without leaving the page. -->
					<a
						class="card"
						href="/title/{credit.source}/{credit.sourceId}?back={encodeURIComponent(here)}"
						title="Read about {credit.title}"
					>
						<div class="poster">
							{#if credit.poster}
								<img src={credit.poster} alt="" loading="lazy" />
							{:else}
								<span class="fallback" aria-hidden="true">?</span>
							{/if}
						</div>
						<h3 class="name">{credit.title}</h3>
						<p class="sub faint tabular">{credit.year || '—'}</p>
						{#if credit.character}
							<p class="role faint">as {credit.character}</p>
						{/if}
					</a>

					{#if justAdded[key]}
						<a class="added-badge" href="/entry/{justAdded[key]}" title="Added — open it">
							Added
						</a>
					{:else}
						<button
							type="button"
							class="add"
							disabled={adding === key}
							title="Add to your watchlist"
							aria-label="Add {credit.title} to your watchlist"
							onclick={() => addToWatchlist(credit)}
						>
							{adding === key ? '…' : '+'}
						</button>
					{/if}
				</li>
			{/each}
		</ul>

		{#if remaining > 0}
			<button type="button" class="btn more" onclick={() => (showing += PAGE)}>
				Show {Math.min(PAGE, remaining)} more
				<span class="faint tabular">({remaining} left)</span>
			</button>
		{/if}
	</section>
{/if}

{#if ownedMenu}
	{@const item = ownedMenu.item}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="ctx-backdrop" onclick={() => (ownedMenu = null)} oncontextmenu={(e) => { e.preventDefault(); ownedMenu = null; }}></div>
	<div class="ctx-menu" style="left: {ownedMenu.x}px; top: {ownedMenu.y}px;">
		<button type="button" onclick={() => watchOwned(item)}>▶ Watch</button>
		<button type="button" onclick={() => { ownedMenu = null; goto(`/entry/${item.id}`); }}>View entry</button>
	</div>
{/if}

{#if menu}
	{@const credit = menu.credit}
	{@const key = `${credit.source}:${credit.sourceId}`}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="ctx-backdrop" onclick={() => (menu = null)} oncontextmenu={(e) => { e.preventDefault(); menu = null; }}></div>
	<div class="ctx-menu" style="left: {menu.x}px; top: {menu.y}px;">
		<button type="button" onclick={() => watch(credit)}>▶ Watch</button>
		<button type="button" onclick={() => { menu = null; goto(`/title/${credit.source}/${credit.sourceId}?back=${encodeURIComponent(here)}`); }}>
			View details
		</button>
		<hr />
		{#if justAdded[key]}
			<button type="button" onclick={() => { menu = null; goto(`/entry/${justAdded[key]}`); }}>View entry</button>
		{:else}
			<button type="button" onclick={() => addAs(credit, 'completed')}>✓ Add as completed</button>
			<button type="button" onclick={() => addAs(credit, 'watching')}>Add as watching</button>
			<button type="button" onclick={() => addAs(credit, 'planned')}>Add as want to watch</button>
		{/if}
	</div>
{/if}

<style>
	.owned {
		position: relative;
	}

	.ctx-backdrop {
		position: fixed;
		inset: 0;
		z-index: 900;
	}

	.ctx-menu {
		position: fixed;
		z-index: 901;
		min-width: 200px;
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

	header {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-bottom: 26px;
	}

	.portrait {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid var(--rule);
		flex-shrink: 0;
	}

	.portrait.empty {
		display: grid;
		place-items: center;
		background: var(--surface-2);
		color: var(--ink-faint);
	}

	h1 {
		font-size: clamp(1.5rem, 4vw, 2rem);
	}

	header p {
		margin: 2px 0 0;
		font-size: 0.88rem;
	}

	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 20px 16px;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.poster {
		aspect-ratio: 2 / 3;
		max-width: 100%;
		background: var(--surface-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		overflow: hidden;
		display: grid;
		place-items: center;
		transition: border-color 0.14s ease;
	}

	.card:hover .poster {
		border-color: var(--accent);
	}

	.poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.fallback {
		font-size: 1.8rem;
		opacity: 0.4;
	}

	.name {
		font-family: var(--body);
		font-size: 0.9rem;
		font-weight: 600;
		line-height: 1.3;
		margin: 0;
		overflow-wrap: anywhere;
	}

	.sub,
	.role {
		font-size: 0.78rem;
		margin: 0;
	}

	.known {
		margin-top: 40px;
		padding-top: 22px;
		border-top: 1px solid var(--rule);
	}

	.known h2 {
		font-size: 1.1rem;
		margin: 0;
	}

	.known .small {
		font-size: 0.85rem;
		margin: 2px 0 12px;
	}

	.known .grid {
		margin-top: 4px;
	}

	.known li {
		position: relative;
	}

	/* Hidden until you point at the poster, so the grid stays calm. */
	.add {
		position: absolute;
		top: 6px;
		right: 6px;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 1px solid var(--accent);
		background: var(--accent);
		color: var(--accent-ink);
		font-size: 1.05rem;
		line-height: 1;
		display: grid;
		place-items: center;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.12s ease;
	}

	.known li:hover .add,
	.add:focus-visible {
		opacity: 1;
	}

	.added-badge {
		position: absolute;
		top: 6px;
		right: 6px;
		background: var(--good);
		color: var(--paper);
		border-radius: 100px;
		padding: 2px 9px;
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.more {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		margin-top: 18px;
	}
</style>
