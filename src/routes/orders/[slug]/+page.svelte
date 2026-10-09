<script lang="ts">
	import MoreButton from '$lib/MoreButton.svelte';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { goto, beforeNavigate, afterNavigate, invalidateAll } from '$app/navigation';
	import { p } from '$lib/poison';
	import BackToTop from '$lib/BackToTop.svelte';
	import { titleProgress } from '$lib/orderProgress';
	import type { PageData } from './$types';
	import type { ResolvedItem, OrderStatus } from '$lib/server/watchOrders';

	let { data }: { data: PageData } = $props();
	const pm = $derived(page.data.poisonMode);

	/* ------------------------------------------------ view options, remembered between visits */

	let view = $state<'timeline' | 'posters'>('timeline');
	let hideWatched = $state(false);
	let showExtras = $state(false);

	let viewLoaded = false;

	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem('orders-view') ?? '{}');
			if (saved.view === 'posters') view = 'posters';
			hideWatched = Boolean(saved.hideWatched);
			showExtras = Boolean(saved.showExtras);
		} catch {}
		viewLoaded = true;
	});

	$effect(() => {
		const saved = { view, hideWatched, showExtras };
		if (!viewLoaded) return;
		try { localStorage.setItem('orders-view', JSON.stringify(saved)); } catch {}
	});

	/* ------------------------------------------------ the list */

	/** Changes made from the menu on this visit, by title — applied over what the page loaded with. */
	let changed = $state<Record<string, { entryId: number | null; status: OrderStatus }>>({});

	/** Skipped or un-skipped on this visit, by item key. */
	let skipChanges = $state<Record<string, boolean>>({});

	const items = $derived(
		data.items.map((item) => ({
			...item,
			...changed[item.sourceId],
			skipped: skipChanges[item.key] ?? item.skipped
		}))
	);
	const released = $derived(items.filter((i) => i.released));
	const upcoming = $derived(items.filter((i) => !i.released));
	/** The numbered titles. Extras sit between them without taking a number. */
	const inOrder = $derived(released.filter((i) => !i.extra));
	/** What "x of y watched" counts: skipped titles are left out. */
	const counted = $derived(inOrder.filter((i) => !i.skipped));
	const extrasCount = $derived(items.filter((i) => i.extra).length);
	// A show's seasons count as one title.
	const progress = $derived(titleProgress(counted));
	const percent = $derived(progress.total ? Math.round((progress.watched / progress.total) * 100) : 0);
	const next = $derived(counted.find((i) => i.status !== 'watched') ?? null);
	const heroImage = $derived((next ?? counted.at(-1) ?? items[0])?.backdropUrl ?? null);

	const numbers = $derived(new Map(inOrder.map((item, i) => [item.key, i + 1])));

	// "Hide watched" hides skipped ones too: both are things you're done with.
	const shown = (item: ResolvedItem) =>
		(showExtras || !item.extra) && !(hideWatched && (item.status === 'watched' || item.skipped) && item.key !== next?.key);

	/** Released titles grouped by year, for the timeline. */
	const years = $derived.by(() => {
		const groups: { year: string; items: ResolvedItem[] }[] = [];
		for (const item of released.filter(shown)) {
			const year = item.year ? String(item.year) : 'TBA';
			if (groups.at(-1)?.year !== year) groups.push({ year, items: [] });
			groups.at(-1)!.items.push(item);
		}
		return groups;
	});
	const upcomingShown = $derived(upcoming.filter(shown));

	const STATUS_LABEL: Record<string, string> = {
		watched: 'Watched',
		watching: 'Watching',
		listed: 'Want to watch',
		dropped: 'Dropped'
	};
	const KIND_LABEL = { film: 'Film', series: 'Series', short: 'Short', special: 'Special' };

	const back = $derived(`?back=${encodeURIComponent(`/orders/${data.id}`)}`);
	const hrefOf = (item: ResolvedItem) =>
		item.entryId ? `/entry/${item.entryId}${back}` : `/title/tmdb/${item.sourceId}${back}`;

	const when = (date: string | null) =>
		date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'TBA';

	const label = (item: ResolvedItem) => (item.season ? `${item.title} · Season ${item.season}` : item.title);

	/* ------------------------------------------------ coming back to the same spot */

	const scrollKey = $derived(`orders-scroll:${data.id}`);

	beforeNavigate(({ to }) => {
		if (to?.url.pathname === page.url.pathname) return;
		try { sessionStorage.setItem(scrollKey, String(window.scrollY)); } catch {}
	});

	afterNavigate(({ from }) => {
		// Only when returning from something opened from this list, not on a fresh visit.
		if (!from || !/^\/(title|entry|watch|person)\b/.test(from.url.pathname)) return;
		let y = 0;
		try { y = Number(sessionStorage.getItem(scrollKey)) || 0; } catch {}
		if (y) setTimeout(() => window.scrollTo(0, y), 0);
	});

	/* ------------------------------------------------ actions */

	let problem = $state('');

	/** Skipping is saved, and takes it out of "up next" and the count. */
	async function setSkipped(item: ResolvedItem, skipped: boolean) {
		skipChanges = { ...skipChanges, [item.key]: skipped };
		await fetch('/api/orders', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ skip: item.key, skipped })
		});
	}

	/** Scrolls down to a title in the list and makes it flash, so you can see where you are. */
	let flashKey = $state<string | null>(null);
	function jumpTo(item: ResolvedItem) {
		document.getElementById(`item-${item.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		flashKey = item.key;
		setTimeout(() => (flashKey = null), 1800);
	}

	function watch(item: ResolvedItem) {
		const params = new URLSearchParams({ title: item.title, type: item.type, auto: '1' });
		if (item.year) params.set('year', String(item.year));
		// A later season you haven't started opens at its first episode.
		if (item.season && item.season > 1 && item.status !== 'watching') {
			params.set('resume_s', String(item.season));
			params.set('resume_e', '1');
		}
		goto(`/watch?${params}`);
	}

	async function add(item: ResolvedItem, status: 'completed' | 'watching' | 'planned') {
		problem = '';
		try {
			const resp = await fetch('/api/add', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ source: 'tmdb', sourceId: item.sourceId, status })
			});
			if (!resp.ok) throw new Error();
			const added = await resp.json();
			const mapped: OrderStatus = status === 'completed' ? 'watched' : status === 'watching' ? 'watching' : 'listed';
			changed = { ...changed, [item.sourceId]: { entryId: added.id, status: mapped } };
		} catch {
			problem = 'That could not be added. Try again in a moment.';
		}
	}

	async function markWatched(item: ResolvedItem) {
		if (!item.entryId) return add(item, 'completed');
		changed = { ...changed, [item.sourceId]: { entryId: item.entryId, status: 'watched' } };
		await fetch('/api/entries', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: item.entryId, action: 'complete' })
		});
	}

	/** Extras are ticked off here only — they never go into the library. */
	async function markExtra(item: ResolvedItem, seen: boolean) {
		changed = { ...changed, [item.sourceId]: { entryId: null, status: seen ? 'watched' : 'none' } };
		await fetch('/api/orders', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ extra: item.sourceId, watched: seen })
		});
	}

	async function removeFromLibrary(item: ResolvedItem) {
		if (!item.entryId) return;
		await fetch('/api/entries', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: item.entryId })
		});
		changed = { ...changed, [item.sourceId]: { entryId: null, status: 'none' } };
	}

	// Flipped straight away when the button is pressed, rather than after the server answers.
	let added = $derived(data.added);
	async function toggleMine() {
		const removing = added;
		added = !added;
		await fetch('/api/orders', {
			method: removing ? 'DELETE' : 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: data.id, name: data.name })
		});
		// invalidateAll: the overview may already be loaded (hovering its link does that) with this order still in it.
		if (removing) goto('/orders', { invalidateAll: true });
		else invalidateAll();
	}

	/* ------------------------------------------------ right-click menu */

	let menu = $state<{ x: number; y: number; item: ResolvedItem } | null>(null);

	function onItemMenu(e: MouseEvent, item: ResolvedItem) {
		e.preventDefault();
		menu = { x: Math.min(e.clientX, window.innerWidth - 210), y: Math.min(e.clientY, window.innerHeight - 260), item };
	}
</script>

<svelte:head><title>{data.name} · Watch list · Catalog</title></svelte:head>

<BackToTop />

<a href="/orders" class="back faint">&larr; Watch list</a>

<section class="hero" class:has-image={heroImage}>
	{#if heroImage}
		<img class="hero-bg" src={heroImage} alt="" />
	{/if}
	<div class="hero-body">
		<div class="hero-text">
			<p class="eyebrow">Watch list · {progress.total} titles</p>
			<h1>{data.name}</h1>
			<p class="summary tabular"><strong>{progress.watched}</strong> of {progress.total} watched</p>
		</div>
		<div class="ring" style:--pct={percent} aria-label="{percent}% watched">
			<svg viewBox="0 0 36 36" aria-hidden="true">
				<circle class="ring-track" cx="18" cy="18" r="15.9" />
				{#if percent > 0}
					<circle class="ring-fill" cx="18" cy="18" r="15.9" pathLength="100" stroke-dasharray="{percent} 100" />
				{/if}
			</svg>
			<span class="tabular">{percent}%</span>
		</div>
	</div>
</section>

{#if next}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<section class="up-next-card" oncontextmenu={(e) => onItemMenu(e, next)}>
		<a href={hrefOf(next)} class="un-poster">
			{#if next.posterUrl}<img src={next.posterUrl} alt="" />{/if}
		</a>
		<div class="un-body">
			<p class="eyebrow accent">Up next · #{numbers.get(next.key)}</p>
			<h2><a href={hrefOf(next)}>{label(next)}</a></h2>
			<p class="faint small">{KIND_LABEL[next.kind]} · {when(next.date)}</p>
			{#if next.overview}<p class="overview">{next.overview}</p>{/if}
			<div class="un-actions">
				<button type="button" class="btn btn-watch" onclick={() => watch(next)}>▶ Watch</button>
				<button type="button" class="btn" onclick={() => markWatched(next)}>✓ Mark as watched</button>
				<button type="button" class="btn" onclick={() => setSkipped(next, true)}>Skip</button>
				<button type="button" class="btn btn-quiet" onclick={() => jumpTo(next)}>↓ Jump to it</button>
			</div>
		</div>
	</section>
{:else if counted.length}
	<p class="all-done">All caught up{upcoming.length ? ` — ${upcoming.length} more on the way` : ''}.</p>
{/if}

<div class="controls">
	<div class="segmented" role="group" aria-label="Layout">
		<button type="button" class:on={view === 'timeline'} onclick={() => (view = 'timeline')}>Timeline</button>
		<button type="button" class:on={view === 'posters'} onclick={() => (view = 'posters')}>Posters</button>
	</div>
	<label class="toggle">
		<input type="checkbox" bind:checked={hideWatched} />
		Hide watched
	</label>
	{#if extrasCount}
		<label class="toggle">
			<input type="checkbox" bind:checked={showExtras} />
			Show extras ({extrasCount})
		</label>
	{/if}
	<button type="button" class="btn mine" onclick={toggleMine}>
		{added ? 'Remove watch list' : '+ Add to my watch lists'}
	</button>
</div>
{#if problem}<p class="msg bad">{problem}</p>{/if}

{#snippet badge(item: ResolvedItem)}
	{#if item.extra}
		<span class="chip extra">Extra</span>
	{/if}
	{#if item.skipped}
		<span class="chip skipped">Skipped</span>
	{/if}
	{#if STATUS_LABEL[item.status]}
		<span class="status {item.status}">{STATUS_LABEL[item.status]}</span>
	{/if}
{/snippet}

{#snippet timelineItem(item: ResolvedItem)}
	<li
		id="item-{item.key}"
		class="t-item has-more"
		class:flash={flashKey === item.key}
		class:skipped={item.skipped}
		class:done={item.status === 'watched'}
		class:is-next={item.key === next?.key}
		class:is-extra={item.extra}
		oncontextmenu={(e) => onItemMenu(e, item)}
	>
		<span class="dot" aria-hidden="true">{item.status === 'watched' ? '✓' : ''}</span>
		<a href={hrefOf(item)} class="t-card">
			<span class="num tabular">{numbers.get(item.key) ?? ''}</span>
			<div class="t-poster">
				{#if item.posterUrl}<img src={item.posterUrl} alt="" loading="lazy" />{/if}
			</div>
			<div class="t-text">
				<span class="title">{label(item)}</span>
				<span class="meta faint">{KIND_LABEL[item.kind]} · {when(item.date)}</span>
			</div>
			<div class="t-badges">
				{@render badge(item)}
				<MoreButton variant="inline" onopen={(e) => onItemMenu(e, item)} />
			</div>
		</a>
	</li>
{/snippet}

{#snippet posterTile(item: ResolvedItem)}
	<li
		id="item-{item.key}"
		class="tile has-more"
		class:flash={flashKey === item.key}
		class:skipped={item.skipped}
		class:done={item.status === 'watched'}
		class:is-next={item.key === next?.key}
		class:is-extra={item.extra}
		oncontextmenu={(e) => onItemMenu(e, item)}
	>
		<a href={hrefOf(item)}>
			<div class="tile-poster">
				{#if item.posterUrl}<img src={item.posterUrl} alt="" loading="lazy" />{/if}
				{#if numbers.get(item.key)}<span class="tile-num tabular">{numbers.get(item.key)}</span>{/if}
				<MoreButton onopen={(e) => onItemMenu(e, item)} />
				{#if item.status === 'watched'}<span class="tile-check" aria-label="Watched">✓</span>{/if}
				{#if item.key === next?.key}<span class="tile-next">Up next</span>{/if}
				{#if item.extra}<span class="tile-extra">{KIND_LABEL[item.kind]}</span>{/if}
				{#if item.skipped}<span class="tile-extra">Skipped</span>{/if}
			</div>
			<span class="tile-title">{label(item)}</span>
			<span class="tile-meta faint">{item.year ?? 'TBA'} · {KIND_LABEL[item.kind]}</span>
		</a>
	</li>
{/snippet}

{#if view === 'timeline'}
	<div class="timeline">
		{#each years as group (group.year)}
			<div class="year">
				<h3 class="year-label tabular">{group.year}</h3>
				<ol>
					{#each group.items as item (item.key)}
						{@render timelineItem(item)}
					{/each}
				</ol>
			</div>
		{/each}
		{#if upcomingShown.length}
			<div class="year upcoming">
				<h3 class="year-label">Coming soon</h3>
				<ol>
					{#each upcomingShown as item (item.key)}
						{@render timelineItem(item)}
					{/each}
				</ol>
			</div>
		{/if}
	</div>
{:else}
	<ol class="tiles">
		{#each released.filter(shown) as item (item.key)}
			{@render posterTile(item)}
		{/each}
	</ol>
	{#if upcomingShown.length}
		<h2 class="coming">Coming soon</h2>
		<ol class="tiles">
			{#each upcomingShown as item (item.key)}
				{@render posterTile(item)}
			{/each}
		</ol>
	{/if}
{/if}

{#if menu}
	{@const item = menu.item}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="ctx-backdrop" onclick={() => (menu = null)} oncontextmenu={(e) => { e.preventDefault(); menu = null; }}></div>
	<div class="ctx-menu" style="left: {menu.x}px; top: {menu.y}px;">
		<button type="button" onclick={() => { watch(item); menu = null; }}>{pm ? p('▶ Watch') : '▶ Watch'}</button>
		<button type="button" onclick={() => { goto(`/title/tmdb/${item.sourceId}${back}`); menu = null; }}>
			{pm ? p('View details') : 'View details'}
		</button>
		<hr />
		{#if item.entryId}
			<button type="button" onclick={() => { goto(`/entry/${item.entryId}${back}`); menu = null; }}>
				{pm ? p('View entry') : 'View entry'}
			</button>
			{#if item.status !== 'watched'}
				<button type="button" onclick={() => { markWatched(item); menu = null; }}>✓ Mark as watched</button>
			{/if}
			<hr />
			<button type="button" class="ctx-danger" onclick={() => { removeFromLibrary(item); menu = null; }}>
				{pm ? p('Remove from library') : 'Remove from library'}
			</button>
		{:else if item.extra}
			{#if item.status === 'watched'}
				<button type="button" onclick={() => { markExtra(item, false); menu = null; }}>Mark as not watched</button>
			{:else}
				<button type="button" onclick={() => { markExtra(item, true); menu = null; }}>✓ Mark as watched</button>
			{/if}
		{:else}
			<button type="button" onclick={() => { add(item, 'completed'); menu = null; }}>
				✓ {pm ? p('Add as completed') : 'Add as completed'}
			</button>
			<button type="button" onclick={() => { add(item, 'watching'); menu = null; }}>
				{pm ? p('Add as watching') : 'Add as watching'}
			</button>
			<button type="button" onclick={() => { add(item, 'planned'); menu = null; }}>
				{pm ? p('Add as want to watch') : 'Add as want to watch'}
			</button>
		{/if}
		{#if !item.extra && item.status !== 'watched'}
			<hr />
			<button type="button" onclick={() => { setSkipped(item, !item.skipped); menu = null; }}>
				{item.skipped ? 'Unskip' : 'Skip'}
			</button>
		{/if}
	</div>
{/if}

<style>
	.back {
		font-size: 0.85rem;
		display: inline-block;
		margin-bottom: 10px;
	}

	.small {
		font-size: 0.82rem;
	}

	.eyebrow {
		margin: 0;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.eyebrow.accent {
		color: var(--accent);
	}

	/* ---------------------------------------------- hero */

	.hero {
		position: relative;
		overflow: hidden;
		border-radius: var(--radius);
		border: 1px solid var(--rule);
		background: var(--surface);
		margin-bottom: 16px;
	}

	.hero-bg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center 25%;
	}

	/* Darkens the picture so the white text stays readable over any backdrop. */
	.hero.has-image::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, rgb(0 0 0 / 82%) 0%, rgb(0 0 0 / 55%) 55%, rgb(0 0 0 / 20%) 100%);
	}

	.hero-body {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 20px;
		padding: 64px 26px 24px;
	}

	.hero.has-image .hero-body {
		color: #fff;
	}

	.hero.has-image .eyebrow,
	.hero.has-image .summary {
		color: rgb(255 255 255 / 75%);
	}

	.hero.has-image .summary strong {
		color: #fff;
	}

	h1 {
		font-size: clamp(1.9rem, 5vw, 2.8rem);
		margin: 2px 0 4px;
	}

	.summary {
		margin: 0;
		color: var(--ink-soft);
	}

	.summary strong {
		color: var(--ink);
	}

	.ring {
		position: relative;
		width: 84px;
		height: 84px;
		flex: none;
	}

	.ring svg {
		width: 100%;
		height: 100%;
		transform: rotate(-90deg);
	}

	.ring circle {
		fill: none;
		stroke-width: 3;
	}

	.ring-track {
		stroke: rgb(128 128 128 / 30%);
	}

	.ring-fill {
		stroke: var(--good);
		stroke-linecap: round;
		transition: stroke-dasharray 0.4s ease;
	}

	.ring span {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		font-weight: 700;
		font-size: 1.05rem;
	}

	/* ---------------------------------------------- up next */

	.up-next-card {
		display: flex;
		gap: 18px;
		padding: 16px;
		margin-bottom: 18px;
		background: var(--accent-bg);
		border: 1px solid var(--accent);
		border-radius: var(--radius);
	}

	.un-poster {
		width: 110px;
		flex: none;
		aspect-ratio: 2 / 3;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--sunk);
		box-shadow: var(--shadow);
	}

	.un-poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.un-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.un-body h2 {
		font-size: 1.35rem;
		margin: 0;
	}

	.un-body h2 a {
		color: inherit;
		text-decoration: none;
	}

	.un-body h2 a:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.un-body p {
		margin: 0;
	}

	.overview {
		margin-top: 6px !important;
		font-size: 0.88rem;
		color: var(--ink-soft);
		max-width: 70ch;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.un-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: auto;
		padding-top: 10px;
	}

	.btn-watch {
		background: var(--good);
		color: var(--paper);
		border-color: var(--good);
		font-weight: 600;
	}

	.btn-watch:hover {
		filter: brightness(1.12);
	}

	.all-done {
		margin: 0 0 18px;
		padding: 14px 16px;
		border-radius: var(--radius);
		background: var(--good-bg);
		color: var(--good);
		font-weight: 600;
	}

	/* ---------------------------------------------- controls */

	.controls {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px 18px;
		margin-bottom: 20px;
	}

	.segmented {
		display: inline-flex;
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.segmented button {
		padding: 6px 14px;
		border: none;
		background: var(--surface);
		color: var(--ink-soft);
		font-size: 0.85rem;
		cursor: pointer;
	}

	.segmented button + button {
		border-left: 1px solid var(--rule-firm);
	}

	.segmented button.on {
		background: var(--accent);
		color: var(--accent-ink);
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.85rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.mine {
		margin-left: auto;
	}

	/* ---------------------------------------------- shared badges */

	.status {
		flex: none;
		font-size: 0.72rem;
		font-weight: 600;
		padding: 3px 8px;
		border-radius: 999px;
		border: 1px solid var(--rule-firm);
		color: var(--ink-soft);
		white-space: nowrap;
	}

	.status.watched {
		color: var(--good);
		border-color: var(--good);
		background: var(--good-bg);
	}

	.status.watching {
		color: var(--accent);
		border-color: var(--accent);
	}

	.chip {
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 2px 7px;
		border-radius: 999px;
		white-space: nowrap;
	}

	.chip.skipped {
		background: var(--surface-2);
		color: var(--ink-faint);
	}

	.t-item.skipped .t-poster,
	.t-item.skipped .title {
		opacity: 0.45;
	}

	.tile.skipped .tile-poster img {
		filter: grayscale(1) brightness(0.5);
	}

	/* "Jump to it" lands here: a brief glow so it's easy to spot. */
	.flash .t-card,
	.flash .tile-poster {
		animation: flash 1.8s ease;
	}

	@keyframes flash {
		0%,
		40% {
			box-shadow: 0 0 0 3px var(--accent);
		}
	}

	.btn-quiet {
		border-color: transparent;
		background: transparent;
	}

	.chip.extra {
		background: var(--warn-bg);
		color: var(--warn);
	}

	/* ---------------------------------------------- timeline */

	.timeline {
		max-width: 780px;
	}

	.year {
		position: relative;
		padding-left: 34px;
		padding-bottom: 6px;
	}

	/* The rail. */
	.year::before {
		content: '';
		position: absolute;
		left: 11px;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--rule);
	}

	.year-label {
		position: relative;
		margin: 0 0 8px -34px;
		padding: 3px 10px;
		display: inline-block;
		font-family: var(--body);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--ink-soft);
		background: var(--surface-2);
		border: 1px solid var(--rule);
		border-radius: 999px;
	}

	.year ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-bottom: 14px;
	}

	.t-item {
		position: relative;
	}

	.dot {
		position: absolute;
		left: -30px;
		top: 50%;
		translate: 0 -50%;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--paper);
		border: 2px solid var(--rule-firm);
		display: grid;
		place-items: center;
		font-size: 0.65rem;
		font-weight: 800;
		color: var(--paper);
	}

	.t-item.done .dot {
		background: var(--good);
		border-color: var(--good);
	}

	.t-item.is-next .dot {
		border-color: var(--accent);
		background: var(--accent);
		box-shadow: 0 0 0 4px var(--accent-bg);
	}

	.t-item.is-extra .dot {
		width: 12px;
		height: 12px;
		left: -27px;
		font-size: 0;
	}

	.t-card {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 12px 8px 8px;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		color: inherit;
		text-decoration: none;
		transition: border-color 0.15s, translate 0.15s;
	}

	.t-card:hover {
		border-color: var(--rule-firm);
		translate: 2px 0;
	}

	.t-item.is-next .t-card {
		border-color: var(--accent);
		background: var(--accent-bg);
	}

	.t-item.is-extra .t-card {
		border-style: dashed;
		background: transparent;
	}

	.num {
		width: 1.8em;
		flex: none;
		text-align: right;
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--ink-faint);
	}

	.t-poster {
		width: 46px;
		height: 69px;
		flex: none;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--sunk);
	}

	.t-poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.t-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.title {
		font-weight: 600;
		font-size: 0.97rem;
		overflow-wrap: anywhere;
	}

	.meta {
		font-size: 0.78rem;
	}

	.t-badges {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.t-item.done .t-poster,
	.t-item.done .title {
		opacity: 0.6;
	}

	.upcoming .t-card {
		background: transparent;
	}

	/* ---------------------------------------------- posters */

	.tiles {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
		gap: 18px 14px;
	}

	.tile a {
		display: flex;
		flex-direction: column;
		gap: 3px;
		color: inherit;
		text-decoration: none;
	}

	.tile-poster {
		position: relative;
		aspect-ratio: 2 / 3;
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--sunk);
		border: 2px solid transparent;
		transition: translate 0.15s, box-shadow 0.15s;
	}

	.tile a:hover .tile-poster {
		translate: 0 -3px;
		box-shadow: var(--shadow);
	}

	.tile-poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.tile.done .tile-poster img {
		filter: grayscale(0.6) brightness(0.55);
	}

	.tile.is-next .tile-poster {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-bg);
	}

	.tile.is-extra .tile-poster {
		border: 2px dashed var(--rule-firm);
	}

	.tile-num {
		position: absolute;
		top: 6px;
		left: 6px;
		min-width: 24px;
		padding: 2px 6px;
		border-radius: 999px;
		background: rgb(0 0 0 / 70%);
		color: #fff;
		font-size: 0.75rem;
		font-weight: 700;
		text-align: center;
	}

	.tile-check {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		font-size: 2.2rem;
		font-weight: 800;
		color: #fff;
		text-shadow: 0 2px 8px rgb(0 0 0 / 60%);
	}

	.tile-next,
	.tile-extra {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 4px;
		text-align: center;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.tile-next {
		background: var(--accent);
		color: var(--accent-ink);
	}

	.tile-extra {
		background: var(--warn-bg);
		color: var(--warn);
	}

	.tile-title {
		margin-top: 4px;
		font-weight: 600;
		font-size: 0.85rem;
		line-height: 1.25;
		overflow-wrap: anywhere;
	}

	.tile-meta {
		font-size: 0.75rem;
	}

	.coming {
		font-size: 1.15rem;
		margin: 30px 0 12px;
	}

	/* ---------------------------------------------- menu */

	.ctx-backdrop {
		position: fixed;
		inset: 0;
		z-index: 900;
	}

	.ctx-menu {
		position: fixed;
		z-index: 901;
		min-width: 190px;
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

	@media (max-width: 620px) {
		.hero-body {
			padding: 48px 16px 18px;
		}

		.ring {
			width: 64px;
			height: 64px;
		}

		.up-next-card {
			flex-direction: column;
		}

		.un-poster {
			width: 90px;
		}

		.mine {
			margin-left: 0;
		}

		.t-badges .status {
			display: none;
		}
	}
</style>
