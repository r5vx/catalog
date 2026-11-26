<script lang="ts">
	import { fitOnScreen } from '$lib/fitOnScreen';
	import { watchTypeOf } from '$lib/watchType';
	import { onReachBottom } from '$lib/infiniteScroll';
	import PosterPlaceholder from '$lib/PosterPlaceholder.svelte';
	import MoreButton from '$lib/MoreButton.svelte';
	import { goto } from '$app/navigation';
	import BackBar from '$lib/BackBar.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Our own id where this person is in the library, the provider's if not. */
	const personKey = $derived(data.person.id || data.person.sourceId);
	// With its own way back, so going back through a title you opened from here, and back
	// again, ends where you started (Browse's Actors, say).
	const here = $derived(data.back ? `/person/${personKey}?back=${encodeURIComponent(data.back)}` : `/person/${personKey}`);

	/**
	 * Video games they voiced, and as whom (Wikidata, src/lib/server/metadata/gameRoles.ts). Asked
	 * once the page shows: the lookup takes a few seconds the first time (kept after). Null while
	 * it's being asked.
	 */
	type GameRole = { title: string; year: number | null; roles: string[]; link: string | null };
	let games = $state<GameRole[] | null>(null);
	let gamesShown = $state(12);
	$effect(() => {
		const sourceId = data.person.sourceId ?? '';
		games = null;
		gamesShown = 12;
		if (!/^(tmdb|anilist):\d+$/.test(sourceId)) {
			games = [];
			return;
		}
		let stale = false;
		fetch(`/api/person/games?id=${encodeURIComponent(sourceId)}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((answer) => {
				if (!stale) games = answer?.games ?? [];
			})
			.catch(() => {
				if (!stale) games = [];
			});
		return () => {
			stale = true;
		};
	});

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
		character?: string | null;
		job?: string | null;
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
		const params = new URLSearchParams({ title: credit.title, type: watchTypeOf(credit), auto: '1' });
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
		const params = new URLSearchParams({ title: item.title, type: watchTypeOf(item), auto: '1' });
		if (item.year) params.set('year', String(item.year));
		goto(`/watch?${params}`);
	}

	function addAs(credit: Credit, status: 'planned' | 'watching' | 'completed') {
		menu = null;
		addToWatchlist(credit, status);
	}

	const PAGE = 20;
	let showing = $state(PAGE);
	let bioOpen = $state(false);
	let roleFilter = $state<'all' | 'movie' | 'tv' | 'acting' | 'crew'>('all');
	let sortBy = $state<'popular' | 'newest' | 'oldest' | 'rating' | 'title'>('popular');

	$effect(() => {
		data.person.sourceId;
		showing = PAGE;
		bioOpen = false;
		roleFilter = 'all';
		sortBy = 'popular';
	});

	function calcAge(birth: string | null, death: string | null): number | null {
		if (!birth) return null;
		const b = new Date(birth + 'T00:00:00');
		if (Number.isNaN(b.getTime())) return null;
		const end = death ? new Date(death + 'T00:00:00') : new Date();
		if (Number.isNaN(end.getTime())) return null;
		let age = end.getFullYear() - b.getFullYear();
		const m = end.getMonth() - b.getMonth();
		if (m < 0 || (m === 0 && end.getDate() < b.getDate())) age--;
		return age >= 0 && age < 140 ? age : null;
	}

	function fmtDate(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso + 'T00:00:00');
		if (Number.isNaN(d.getTime())) return iso;
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	const age = $derived(calcAge(data.person.birthday, data.person.deathday));
	const lifeLine = $derived.by(() => {
		const parts: string[] = [];
		if (data.person.birthday) {
			if (data.person.deathday) {
				parts.push(`${fmtDate(data.person.birthday)} – ${fmtDate(data.person.deathday)}${age !== null ? ` (aged ${age})` : ''}`);
			} else {
				parts.push(`Born ${fmtDate(data.person.birthday)}${age !== null ? ` (age ${age})` : ''}`);
			}
		}
		if (data.person.placeOfBirth) parts.push(data.person.placeOfBirth);
		return parts.join(' · ');
	});

	const knownForList = $derived(data.knownFor as Credit[]);

	const hasMovies = $derived(knownForList.some((c: Credit) => c.categorySlug === 'movies'));
	const hasTv = $derived(knownForList.some((c: Credit) => c.categorySlug !== 'movies'));
	const hasActing = $derived(knownForList.some((c: Credit) => Boolean(c.character)));
	const hasCrew = $derived(knownForList.some((c: Credit) => !c.character && 'job' in c && Boolean(c.job)));

	const filteredKnownFor = $derived.by(() => {
		let list = knownForList;
		if (roleFilter === 'movie') list = list.filter((c: Credit) => c.categorySlug === 'movies');
		else if (roleFilter === 'tv') list = list.filter((c: Credit) => c.categorySlug !== 'movies');
		else if (roleFilter === 'acting') list = list.filter((c: Credit) => Boolean(c.character));
		else if (roleFilter === 'crew') list = list.filter((c: Credit) => !c.character && 'job' in c && Boolean(c.job));

		if (sortBy === 'popular') return list;
		const copy = [...list];
		if (sortBy === 'newest') copy.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
		else if (sortBy === 'oldest') copy.sort((a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999));
		else if (sortBy === 'rating') copy.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
		else if (sortBy === 'title') copy.sort((a, b) => a.title.localeCompare(b.title));
		return copy;
	});

	const visible = $derived(filteredKnownFor.slice(0, showing));
	const remaining = $derived(filteredKnownFor.length - visible.length);
</script>

<svelte:head><title>{data.person.name} · Catalog</title></svelte:head>

<BackBar href={data.back} />

<header>
	{#if data.person.photo}
		<img class="portrait" src={data.person.photo} alt="" />
	{:else}
		<div class="portrait empty" aria-hidden="true">?</div>
	{/if}
	<div class="head-info">
		<div class="head-title">
			<h1>{data.person.name}</h1>
			{#if data.person.department}
				<span class="dept-chip">{data.person.department}</span>
			{/if}
		</div>
		{#if lifeLine}
			<p class="muted life-line">{lifeLine}</p>
		{/if}
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

{#if data.person.biography}
	<section class="bio">
		<p class:clamped={!bioOpen}>{data.person.biography}</p>
		{#if data.person.biography.length > 260}
			<button type="button" class="bio-toggle" onclick={() => (bioOpen = !bioOpen)}>
				{bioOpen ? 'Show less' : 'Read full biography'}
			</button>
		{/if}
	</section>
{/if}

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
		<div class="known-bar">
			<div>
				<h2>Also known for <span class="faint small tabular">({filteredKnownFor.length})</span></h2>
				<p class="muted small">Not in your library.</p>
			</div>
			<div class="known-controls">
				<div class="filter-pills" role="group" aria-label="Filter credits">
					<button type="button" class="pill" class:on={roleFilter === 'all'} onclick={() => { roleFilter = 'all'; showing = PAGE; }}>All</button>
					{#if hasMovies}
						<button type="button" class="pill" class:on={roleFilter === 'movie'} onclick={() => { roleFilter = 'movie'; showing = PAGE; }}>Movies</button>
					{/if}
					{#if hasTv}
						<button type="button" class="pill" class:on={roleFilter === 'tv'} onclick={() => { roleFilter = 'tv'; showing = PAGE; }}>TV</button>
					{/if}
					{#if hasActing && hasCrew}
						<button type="button" class="pill" class:on={roleFilter === 'acting'} onclick={() => { roleFilter = 'acting'; showing = PAGE; }}>Acting</button>
						<button type="button" class="pill" class:on={roleFilter === 'crew'} onclick={() => { roleFilter = 'crew'; showing = PAGE; }}>Crew &amp; Music</button>
					{/if}
				</div>
				<div class="sort-pills" role="group" aria-label="Sort credits">
					<button type="button" class="pill" class:on={sortBy === 'popular'} onclick={() => (sortBy = 'popular')}>Popular</button>
					<button type="button" class="pill" class:on={sortBy === 'newest'} onclick={() => (sortBy = 'newest')}>Newest</button>
					<button type="button" class="pill" class:on={sortBy === 'oldest'} onclick={() => (sortBy = 'oldest')}>Oldest</button>
					<button type="button" class="pill" class:on={sortBy === 'rating'} onclick={() => (sortBy = 'rating')}>Top rated</button>
					<button type="button" class="pill" class:on={sortBy === 'title'} onclick={() => (sortBy = 'title')}>A–Z</button>
				</div>
			</div>
		</div>

		<ul class="grid">
			{#each visible as credit (credit.source + ':' + credit.sourceId)}
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
								<PosterPlaceholder title={credit.title} year={credit.year} kind={credit.kind} />
							{/if}
						</div>
						<h3 class="name">{credit.title}</h3>
						<p class="sub faint tabular">{credit.year || '—'}</p>
						{#if credit.character}
							<p class="role faint">as {credit.character}</p>
						{:else if 'job' in credit && credit.job}
							<p class="role faint">{credit.job}</p>
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
			<div class="scroll-sentinel" use:onReachBottom={() => (showing += PAGE)}>
				<span class="faint small">Loading more…</span>
			</div>
		{/if}
	</section>
{/if}

<!-- Only once there's something: most people have no games, and an empty heading says nothing. -->
{#if games && games.length > 0}
	<section class="known games">
		<h2>Video games</h2>
		<p class="muted small">Voice roles, from Wikidata.</p>
		<ul class="game-list">
			{#each games.slice(0, gamesShown) as game (game.title + (game.year ?? ''))}
				<li>
					<span class="year faint tabular">{game.year ?? '—'}</span>
					<span class="game">
						{#if game.link}<a href={game.link} target="_blank" rel="noopener noreferrer">{game.title}</a>{:else}{game.title}{/if}
						{#if game.roles.length}<span class="role faint">as {game.roles.join(', ')}</span>{/if}
					</span>
				</li>
			{/each}
		</ul>
		{#if games.length > gamesShown}
			<div class="scroll-sentinel" use:onReachBottom={() => (gamesShown += 24)}>
				<span class="faint small">Loading more…</span>
			</div>
		{/if}
	</section>
{/if}

{#if ownedMenu}
	{@const item = ownedMenu.item}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="ctx-backdrop" onclick={() => (ownedMenu = null)} oncontextmenu={(e) => { e.preventDefault(); ownedMenu = null; }}></div>
	<div class="ctx-menu" use:fitOnScreen style="left: {ownedMenu.x}px; top: {ownedMenu.y}px;">
		<button type="button" onclick={() => watchOwned(item)}>▶ Watch</button>
		<button type="button" onclick={() => { ownedMenu = null; goto(`/entry/${item.id}`); }}>View entry</button>
	</div>
{/if}

{#if menu}
	{@const credit = menu.credit}
	{@const key = `${credit.source}:${credit.sourceId}`}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="ctx-backdrop" onclick={() => (menu = null)} oncontextmenu={(e) => { e.preventDefault(); menu = null; }}></div>
	<div class="ctx-menu" use:fitOnScreen style="left: {menu.x}px; top: {menu.y}px;">
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

	.head-title {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.dept-chip {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 3px 9px;
		border-radius: 999px;
		background: var(--accent-soft, rgba(232, 93, 154, 0.14));
		color: var(--accent);
		border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
	}

	.life-line {
		font-size: 0.86rem;
	}

	.bio {
		max-width: 72ch;
		margin: -10px 0 26px;
		padding: 14px 16px;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
	}

	.bio p {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.55;
		color: var(--ink-muted);
		white-space: pre-line;
	}

	.bio p.clamped {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.bio-toggle {
		margin-top: 8px;
		padding: 0;
		border: none;
		background: none;
		color: var(--accent);
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
	}

	.bio-toggle:hover {
		text-decoration: underline;
	}

	.known-bar {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 14px;
		flex-wrap: wrap;
		margin-bottom: 14px;
	}

	.known-controls {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.filter-pills,
	.sort-pills {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-wrap: wrap;
	}

	.pill {
		padding: 4px 10px;
		border-radius: 999px;
		border: 1px solid var(--rule);
		background: var(--surface);
		color: var(--ink-muted);
		font-size: 0.78rem;
		cursor: pointer;
		transition: border-color 0.12s, background 0.12s, color 0.12s;
	}

	.pill:hover {
		border-color: var(--rule-firm);
		color: var(--ink);
	}

	.pill.on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink, #fff);
	}

	.scroll-sentinel {
		padding: 20px 0;
		text-align: center;
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

	/* Video games: one line each, the year, the game (to its Wikipedia page) and who they voiced. */
	.game-list {
		list-style: none;
		margin: 14px 0 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 8px 24px;
	}

	.game-list li {
		display: flex;
		gap: 12px;
		align-items: baseline;
		min-width: 0;
	}

	.game-list .year {
		flex: none;
		width: 3.2em;
		font-size: 0.85rem;
	}

	.game-list .game {
		display: flex;
		flex-direction: column;
		min-width: 0;
		font-weight: 600;
	}

	.game-list .game a:hover {
		color: var(--accent);
	}

	.game-list .role {
		font-weight: 400;
		font-size: 0.85rem;
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
