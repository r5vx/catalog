<!--
	The top of the library, Notes and Watch list: title, buttons, stat tiles
	and the "Back to top" button.
	One component so switching between those tabs never moves anything.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { p } from '$lib/altText';
	import BackToTop from '$lib/BackToTop.svelte';
	import Wordmark from '$lib/Wordmark.svelte';
	import MyProfileButton from '$lib/MyProfileButton.svelte';
	import type { Category } from '$lib/server/db/types';

	type Props = {
		categories: Category[];
		countByCategory: Record<number, number>;
		total: number;
		completed: number;
		completedByCategory: Record<number, number>;
		altMode?: boolean;
		/** The last three watched posters, overall and per category (db/queries.ts recentlyWatchedPosters). */
		posters?: { all: string[]; byCategory: Record<number, string[]> } | null;
	};

	let { categories, countByCategory, total, completed, completedByCategory, altMode = false, posters = null }: Props = $props();
	const pm = $derived(altMode);

	// A category whose tab is hidden loses its tile too.
	const hiddenTabs = $derived<string[]>(page.data.hiddenTabs ?? []);

	// How much you've watched is about the library: not shown over Friends, the Watch list or Notes.
	const showStats = $derived(
		!/^\/(notes|orders)(\/|$)/.test(page.url.pathname) && page.url.searchParams.get('cat') !== 'friends'
	);
</script>

<BackToTop />

<header class="masthead">
	<div class="title-row">
		{#if pm}
			<h1>{p('Catalog')}</h1>
		{:else}
			<!-- The logo; with the sidebar showing it's at the top of the sidebar instead. -->
			<h1 class="brand"><Wordmark height="2.1rem" /></h1>
		{/if}
		<div class="header-actions">
			{#if page.data.whoIsWatching}
				<!-- who's watching on this phone: tapped, the picker -->
				<a href="/profiles?next={encodeURIComponent(page.url.pathname + page.url.search)}" class="who" title="Watching as {page.data.whoIsWatching.name}. Change" aria-label="Watching as {page.data.whoIsWatching.name}. Change">
					<span class="who-avatar" style:background={page.data.whoIsWatching.color}>{page.data.whoIsWatching.name.slice(0, 1).toUpperCase()}</span>
				</a>
			{/if}
			<MyProfileButton />
			<a href="/settings" class="btn" title="Settings" aria-label="Settings">⚙</a>
			<a href="/browse" class="btn">{pm ? p('Browse') : 'Browse'}</a>
			<a href="/live" class="btn side-link">Live TV</a>
			<a href="/youtube" class="btn side-link">YouTube</a>
			<a href="/downloads" class="btn side-link">Downloads</a>
			<a href="/entry/new" class="btn btn-primary">{pm ? p('alt:+ Add') : '+ Add'}</a>
		</div>
	</div>
	{#if showStats}
	<div class="stat-tiles">
		{@render tile(pm ? p('alt:Watched') : 'Watched', completed, total, posters?.all ?? [])}
		{#each categories.filter((c) => !hiddenTabs.includes(c.slug)) as cat (cat.id)}
			{@render tile(cat.name, completedByCategory[cat.id] ?? 0, countByCategory[cat.id] ?? 0, posters?.byCategory[cat.id] ?? [])}
		{/each}
	</div>
	{/if}
</header>

<!--
	One stat tile (owner, 2026-11-15: "make them custom ... more interesting than just grey boxes",
	then picked these): the number, the last three watched posters fanned out on the right (newest
	in front), the newest one blurred faintly behind everything, and how far through it you are
	as a bar along the bottom in the accent.
-->
{#snippet tile(label: string, done: number, of: number, list: string[])}
	<div class="tile" class:with-posters={list.length > 0}>
		{#if list[0]}<span class="tile-wash" aria-hidden="true" style:background-image="url('{list[0]}')"></span>{/if}
		{#if list.length}
			<span class="tile-posters" aria-hidden="true">
				{#each list as src, i (i)}
					<img class="fan-{i}" {src} alt="" />
				{/each}
			</span>
		{/if}
		<span class="tile-label">{label}</span>
		<span class="tile-value">{done} <span class="tile-of">of {of}</span></span>
		<span class="tile-bar" aria-hidden="true"><span style:width="{of ? Math.round((done / of) * 100) : 0}%"></span></span>
	</div>
{/snippet}

<style>
	/* (With the sidebar showing, Live TV, YouTube and Downloads are in it.) */
	@media (min-width: 901px) {
		:global(.beside-nav) .side-link {
			display: none;
		}
	}

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

	.brand {
		line-height: 0;
		color: var(--ink);
	}

	@media (min-width: 901px) {
		:global(.beside-nav) .brand {
			display: none;
		}
	}

	.header-actions {
		display: flex;
		flex-wrap: wrap;
		/* Stays on the right when the logo is in the sidebar instead. */
		margin-left: auto;
		gap: 8px;
	}

	.who {
		display: flex;
		align-items: center;
		text-decoration: none;
	}

	.who-avatar {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		font-weight: 600;
		color: #fff;
	}

	/* On a phone the buttons get their own row rather than running off the
	   right edge, and share the width evenly. */
	@media (max-width: 460px) {
		.header-actions {
			width: 100%;
		}

		.header-actions a:not([aria-label='Settings']):not(.who) {
			flex: 1;
			justify-content: center;
		}
	}

	/* Library stats: one tile for everything, then one per category. */
	.stat-tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
		gap: 10px;
		margin-top: 14px;
		max-width: 980px;
	}

	.tile {
		position: relative;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		gap: 2px;
		min-height: 84px;
		padding: 12px 14px 16px;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		overflow: hidden;
		isolation: isolate;
	}

	/* The newest poster, blurred and faint, gives each tile its own color. */
	.tile-wash {
		position: absolute;
		inset: -20px;
		z-index: -2;
		background-size: cover;
		background-position: center;
		filter: blur(22px) saturate(1.3);
		opacity: 0.22;
	}

	/* The last three posters, fanned on the right; they spread a little more on hover. */
	.tile-posters {
		position: absolute;
		top: 10px;
		right: 12px;
		z-index: -1;
		width: 76px;
		height: 60px;
	}

	.tile-posters img {
		position: absolute;
		top: 0;
		left: 21px;
		width: 34px;
		aspect-ratio: 2 / 3;
		object-fit: cover;
		border-radius: 4px;
		box-shadow: 0 3px 10px rgb(0 0 0 / 0.35);
		transition: transform 0.25s ease;
	}

	.tile-posters .fan-0 {
		z-index: 3;
		transform: translateY(-2px);
	}

	.tile-posters .fan-1 {
		z-index: 2;
		transform: translateX(-18px) rotate(-12deg);
	}

	.tile-posters .fan-2 {
		z-index: 1;
		transform: translateX(18px) rotate(12deg);
	}

	.tile:hover .fan-0 {
		transform: translateY(-5px) scale(1.05);
	}

	.tile:hover .fan-1 {
		transform: translateX(-26px) rotate(-18deg);
	}

	.tile:hover .fan-2 {
		transform: translateX(26px) rotate(18deg);
	}

	.tile-label {
		font-size: 0.78rem;
		color: var(--ink-soft);
	}

	.tile-value {
		font-size: 1.4rem;
		font-weight: 600;
		line-height: 1.2;
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}

	.tile-of {
		font-size: 0.85rem;
		font-weight: 400;
		color: var(--ink-faint);
	}

	/* How far through it you are: a thin bar in the accent along the bottom edge. */
	.tile-bar {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 4px;
		background: color-mix(in srgb, var(--ink) 8%, transparent);
	}

	.tile-bar span {
		display: block;
		height: 100%;
		background: var(--accent);
		border-radius: 0 2px 2px 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.tile-posters img {
			transition: none;
		}
	}
</style>
