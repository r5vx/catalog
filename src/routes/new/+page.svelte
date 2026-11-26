<script lang="ts">
	import { mixWeekly } from '$lib/mixWeekly';
	import BackBar from '$lib/BackBar.svelte';
	import ContinueCard from '$lib/ContinueCard.svelte';
	import { playHref } from '$lib/tv/tiles';
	import { withBack } from '$lib/back';
	import { goto, invalidateAll } from '$app/navigation';
	import { fitOnScreen } from '$lib/fitOnScreen';
	import type { ContinueItem } from '$lib/server/db/queries';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let dismissedCw = $state<Set<string>>(new Set());
	let cwCtx = $state<{ x: number; y: number; item: ContinueItem; href: string } | null>(null);
	function openCwCtx(e: MouseEvent, item: ContinueItem, href: string) {
		e.preventDefault();
		e.stopPropagation();
		cwCtx = { x: e.clientX, y: e.clientY, item, href };
	}
	function closeCwCtx() { cwCtx = null; }
	async function removeContinue(item: ContinueItem) {
		dismissedCw = new Set([...dismissedCw, `${item.title}:${item.type}`]);
		await fetch(`/api/watch/progress?title=${encodeURIComponent(item.title)}&type=${item.type}&hide=1`, { method: 'DELETE' });
		invalidateAll();
	}

	type List = Awaited<PageData['lists']['streaming']>;
	type Item = List['items'][number];

	/* ------------------------------------------------------------ dates */

	const asDate = (d: string) => {
		const [y, m, day] = d.split('-').map(Number);
		return new Date(y, m - 1, day);
	};
	const short = (d: string) => asDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	const daysFrom = (d: string) => Math.round((asDate(d).getTime() - asDate(data.week.today).getTime()) / 86_400_000);
	/** "Today", "Yesterday", "Tomorrow", else the weekday ("Tuesday"). */
	function dayName(d: string): string {
		const n = daysFrom(d);
		if (n === 0) return 'Today';
		if (n === -1) return 'Yesterday';
		if (n === 1) return 'Tomorrow';
		return asDate(d).toLocaleDateString('en-US', { weekday: 'long' });
	}

	/** The seven days of the week strip, oldest first, ending today. */
	const days = $derived.by(() => {
		const out: string[] = [];
		const start = asDate(data.week.start);
		for (let i = 0; i < 7; i++) {
			const d = new Date(start);
			d.setDate(start.getDate() + i);
			out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
		}
		return out;
	});

	/* ------------------------------------------------------------ the hero */

	/** The week's biggest releases with a wide picture, taken in turn from each list. */
	let hero = $state<(Item & { tag: string })[]>([]);
	let shown = $state(0);
	let pending = $state(4);
	let hovered = $state(false);
	let focused = $state(false);
	let reducedMotion = $state(true);
	let manualMove = $state(0);
	function moveTo(index: number) {
		shown = (index + hero.length) % hero.length;
		manualMove += 1;
	}
	onMount(() => {
		try {
			localStorage.setItem('catalog:thisWeekOpened', String(Date.now()));
			window.dispatchEvent(new Event('catalog:thisWeekSeen'));
		} catch {}
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		const update = () => (reducedMotion = motion.matches);
		update();
		motion.addEventListener('change', update);
		return () => motion.removeEventListener('change', update);
	});
	$effect(() => {
		const lists = [
			data.lists.cinemas.then((l) => l.items.map((i) => ({ ...i, tag: 'In cinemas' }))),
			data.lists.streaming.then((l) => l.items.map((i) => ({ ...i, tag: 'New to stream' }))),
			data.lists.shows.then((l) => l.items.map((i) => ({ ...i, tag: 'New show' }))),
			data.lists.anime.then((l) => l.items.map((i) => ({ ...i, tag: i.what })))
		];
		hero = [];
		shown = 0;
		pending = lists.length;
		let gone = false;
		const buckets: (Item & { tag: string })[][] = lists.map(() => []);
		lists.forEach((list, i) => list.then((items) => {
			if (gone) return;
			buckets[i] = items.filter(item => item.backdrop);
			hero = mixWeekly(buckets, 8);
			pending -= 1;
		}));
		return () => (gone = true);
	});
	$effect(() => {
		manualMove;
		if (hero.length < 2 || hovered || focused || reducedMotion) return;
		const timer = setInterval(() => {
			if (!document.hidden) shown = (shown + 1) % hero.length;
		}, 8000);
		return () => clearInterval(timer);
	});
	const featured = $derived(hero[shown]);

	/** Days opened past their first six. */
	let openDays = $state<string[]>([]);
	export const snapshot = {
		capture: () => [...openDays],
		restore: (days: string[]) => { openDays = days; }
	};
	/** The week strip starts scrolled to its end, so today shows. */
	const toToday = (el: HTMLElement) => {
		let moved = false;
		const phone = matchMedia('(max-width: 640px)');
		const scroll = () => { if (!moved) el.scrollLeft = el.scrollWidth; };
		const markMoved = () => (moved = true);
		const resize = () => { if (phone.matches) scroll(); };
		scroll();
		phone.addEventListener('change', resize);
		el.addEventListener('pointerdown', markMoved);
		el.addEventListener('wheel', markMoved, { passive: true });
		el.addEventListener('keydown', markMoved);
		return () => {
			phone.removeEventListener('change', resize);
			el.removeEventListener('pointerdown', markMoved);
			el.removeEventListener('wheel', markMoved);
			el.removeEventListener('keydown', markMoved);
		};
	};
</script>

<svelte:head><title>Home · Catalog</title></svelte:head>

<BackBar />

<section class="hero" class:empty={!featured && !pending} aria-label="Home"
	onmouseenter={() => (hovered = true)} onmouseleave={() => (hovered = false)}
	onfocusin={() => (focused = true)} onfocusout={(event) => { focused = event.currentTarget.contains(event.relatedTarget as Node | null); }}>
	<div class="backdrops" aria-hidden="true">
		{#each hero as item, i (item.key)}
			<img src={item.backdrop} alt="" class:on={i === shown} loading={i < 2 ? 'eager' : 'lazy'} />
		{/each}
	</div>
	<div class="hero-shade" aria-hidden="true"></div>
	<div class="hero-words">
		<p class="eyebrow">{short(data.week.start)} – {short(data.week.today)}</p>
		<h1>Home</h1>
		{#if featured}
			{#key featured.key}
				<a class="featured" href={featured.href}>
					<span class="tag">{featured.tag}</span>
					<strong>{featured.title}</strong>
					{#if featured.overview}<span class="blurb">{featured.overview}</span>{/if}
				</a>
			{/key}
			{#if hero.length > 1}
				<div class="slide-controls">
					<button type="button" aria-label="Previous release" onclick={() => moveTo(shown - 1)}>‹</button>
				<div class="dots">
					{#each hero as item, i (item.key)}
						<button type="button" class:on={i === shown} aria-current={i === shown ? 'true' : undefined} aria-label="Show {item.title}" onclick={() => moveTo(i)}></button>
					{/each}
				</div>
					<button type="button" aria-label="Next release" onclick={() => moveTo(shown + 1)}>›</button>
				</div>
			{/if}
		{:else if pending}
			<p>Loading releases…</p>
		{:else}
			<p>No featured releases this week.</p>
		{/if}
	</div>
</section>

{#await data.continueWatching then items}
	{@const visibleCw = items.filter((item) => !dismissedCw.has(`${item.title}:${item.type}`))}
	{#if visibleCw.length}
		<section class="block"><h2>Continue watching</h2><div class="continue-list">
			{#each visibleCw as item (`${item.title}:${item.type}`)}
				{@const href = withBack(item.href ?? playHref(item.title, item.type, null, item.season, item.episode), '/new')}
				<ContinueCard {item} {href} oncontextmenu={(e) => openCwCtx(e, item, href)} />
			{/each}
		</div></section>
	{/if}
{/await}

{#if cwCtx}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="cw-ctx-backdrop" onclick={closeCwCtx} oncontextmenu={(e) => { e.preventDefault(); closeCwCtx(); }}></div>
	<div class="cw-ctx-menu" use:fitOnScreen style="left: {cwCtx.x}px; top: {cwCtx.y}px;">
		<button type="button" onclick={() => { goto(cwCtx!.href); closeCwCtx(); }}>▶ Resume</button>
		{#if cwCtx.item.entryId}
			<button type="button" onclick={() => { goto(`/entry/${cwCtx!.item.entryId}`); closeCwCtx(); }}>View details</button>
		{:else}
			<button type="button" onclick={() => { goto(`/browse?q=${encodeURIComponent(cwCtx!.item.title)}`); closeCwCtx(); }}>View details</button>
		{/if}
		<button type="button" onclick={() => { goto(`/browse?q=${encodeURIComponent(cwCtx!.item.title)}`); closeCwCtx(); }}>Search in Browse</button>
		<hr />
		<button type="button" class="cw-ctx-danger" onclick={() => { removeContinue(cwCtx!.item); closeCwCtx(); }}>Remove from Continue watching</button>
	</div>
{/if}

{@render row('From your watch list', data.watchList, true)}

{#snippet failure()}
	<p class="failure" role="status">Couldn't load. <button type="button" onclick={() => invalidateAll()}>Try again</button></p>
{/snippet}

{#await data.yours}
	<section class="block"><h2>New episodes of your shows</h2><div class="posters loading"></div></section>
{:then yours}
	{#if yours.out.length || yours.soon.length || yours.failed}
		<section class="block">
			<h2>New episodes of your shows</h2>
			{#if yours.failed}{@render failure()}{/if}
			{#if yours.out.length}
				<div class="stills">
					{#each yours.out as item (item.key)}
						<a class="still" href={item.href}>
							<span class="still-pic">
								{#if item.backdrop}<img src={item.backdrop} alt="" loading="lazy" />{/if}
								<span class="when">{dayName(item.date)}</span>
							</span>
							<strong>{item.title}</strong>
							<span class="muted">{item.what}</span>
						</a>
					{/each}
				</div>
			{/if}
			{#if yours.soon.length}
				<h3>Coming up</h3>
				<ul class="soon">
					{#each yours.soon as item (item.key)}
						<li>
							<a href={item.href} class:with-poster={Boolean(item.poster)}>
								{#if item.poster}<img src={item.poster} alt="" loading="lazy" />{/if}
								<span class="soon-words"><strong>{item.title}</strong><span class="muted">{item.what}</span></span>
								<span class="soon-day">{dayName(item.date)}</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
{/await}

{@render row('New movies to stream', data.lists.streaming)}
{@render row('New TV shows', data.lists.shows)}
{@render row('Movies in cinemas', data.lists.cinemas)}

{#await data.lists.anime}
	<section class="block"><h2>Anime this week</h2><div class="week loading"></div></section>
{:then result}
	{@const anime = result.items}
	{#if anime.length || result.failed}
		<section class="block">
			<h2>Anime this week</h2>
			{#if result.failed}{@render failure()}{/if}
			{#if anime.length}
			<div class="week" {@attach toToday}>
				{#each days as d (d)}
					{@const that = anime.filter((a) => a.date === d)}
					<div class="day" class:today={d === data.week.today}>
						<p class="day-name">{dayName(d)}<span>{short(d)}</span></p>
						{#each openDays.includes(d) ? that : that.slice(0, 6) as item (item.key)}
							<a class="ep" href={item.href} title={item.title}>
								{#if item.poster}<img src={item.poster} alt="" loading="lazy" />{/if}
								<span class="ep-words"><strong>{item.title}</strong><span>{item.what}</span></span>
							</a>
						{/each}
						{#if that.length > 6 && !openDays.includes(d)}
							<button type="button" class="more" onclick={() => (openDays = [...openDays, d])}>+{that.length - 6} more</button>
						{/if}
						{#if !that.length}<p class="more muted">Nothing new</p>{/if}
					</div>
				{/each}
			</div>
			{/if}
		</section>
	{/if}
{/await}

{#snippet row(title: string, list: Promise<List>, details = false)}
	{#await list}
		<section class="block"><h2>{title}</h2><div class="posters loading"></div></section>
	{:then result}
		{@const items = result.items}
		{#if items.length || result.failed}
			<section class="block">
				<h2>{title}</h2>
				{#if result.failed}{@render failure()}{/if}
				<div class="posters">
					{#each items as item (item.key)}
						<a class="poster" href={item.href}>
							<span class="poster-pic">
								{#if item.poster}<img src={item.poster} alt="" loading="lazy" />{/if}
								<span class="when">{details ? short(item.date) : dayName(item.date)}</span>
								{#if item.owned}<span class="owned">In your library</span>{/if}
							</span>
							<strong>{item.title}</strong>
							{#if details}<span class="muted">{item.what}</span>{/if}
						</a>
					{/each}
				</div>
			</section>
		{/if}
	{/await}
{/snippet}



<style>
	.continue-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(155px, 1fr)); gap: 20px 16px; }
	@media (max-width: 560px) { .continue-list { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px 10px; } }
	.slide-controls { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
	.slide-controls > button { flex: 0 0 44px; width: 44px; height: 44px; border: 1px solid rgb(255 255 255 / 60%); border-radius: 50%; background: rgb(0 0 0 / 35%); color: #fff; font-size: 1.8rem; cursor: pointer; }
	.slide-controls .dots { margin-top: 0; flex-wrap: wrap; }
	.hero.empty { min-height: 180px; }
	.failure { color: var(--ink-soft); }
	.failure button { font: inherit; color: inherit; text-decoration: underline; cursor: pointer; background: none; border: 0; padding: 0 4px; }
	/* ------------------------------------------------------------ the hero: the week's biggest, drifting */
	.hero {
		position: relative;
		min-height: clamp(300px, 46vh, 520px);
		border-radius: 18px;
		overflow: hidden;
		background: var(--sunk);
		isolation: isolate;
		display: flex;
		align-items: flex-end;
	}

	.backdrops img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: 0;
		transform: scale(1.02);
		transition: opacity 1.4s ease;
	}

	/* The one showing fades in and slowly closes in (8 s, then the next). */
	.backdrops img.on {
		opacity: 1;
		animation: close-in 9s ease-out forwards;
	}

	@keyframes close-in {
		from {
			transform: scale(1.02) translate(0, 0);
		}
		to {
			transform: scale(1.12) translate(1.5%, 1%);
		}
	}

	.hero-shade {
		position: absolute;
		inset: 0;
		background:
			linear-gradient(to top, rgb(0 0 0 / 82%) 0%, rgb(0 0 0 / 35%) 45%, transparent 75%),
			linear-gradient(to right, rgb(0 0 0 / 55%), transparent 60%);
	}

	.hero-words {
		position: relative;
		padding: clamp(20px, 4vw, 44px);
		max-width: 720px;
		color: #fff;
	}

	.eyebrow {
		margin: 0;
		font-size: 0.85rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: rgb(255 255 255 / 75%);
	}

	h1 {
		margin: 4px 0 18px;
		font-family: var(--display);
		font-size: clamp(2.6rem, 7vw, 4.6rem);
		line-height: 0.95;
		letter-spacing: -0.02em;
	}

	.featured {
		display: grid;
		gap: 4px;
		color: inherit;
		text-decoration: none;
		animation: rise 0.6s ease both;
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
	}

	.featured strong {
		font-size: clamp(1.3rem, 3vw, 1.9rem);
		font-weight: 650;
	}

	.featured:hover strong {
		text-decoration: underline;
		text-underline-offset: 4px;
	}

	.tag {
		justify-self: start;
		padding: 2px 9px;
		border-radius: 999px;
		background: var(--accent);
		color: var(--accent-ink);
		font-size: 0.75rem;
		font-weight: 650;
	}

	.blurb {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		color: rgb(255 255 255 / 82%);
		max-width: 60ch;
	}

	.dots {
		display: flex;
		gap: 6px;
		margin-top: 16px;
	}

	.dots button {
		width: 22px;
		height: 4px;
		padding: 0;
		border: 0;
		border-radius: 2px;
		background: rgb(255 255 255 / 35%);
		cursor: pointer;
		transition: background 0.3s, width 0.3s;
	}

	.dots button.on {
		width: 38px;
		background: #fff;
	}

	/* ------------------------------------------------------------ sections */
	.block {
		margin-top: 34px;
	}

	h2 {
		margin: 0 0 12px;
		font-family: var(--display);
		font-size: 1.5rem;
	}

	h3 {
		margin: 22px 0 8px;
		font-size: 1rem;
		color: var(--ink-soft);
	}

	.muted {
		color: var(--ink-faint);
	}

	.when {
		position: absolute;
		left: 8px;
		bottom: 8px;
		padding: 2px 8px;
		border-radius: 999px;
		background: rgb(0 0 0 / 70%);
		color: #fff;
		font-size: 0.75rem;
		font-weight: 600;
	}

	/* Your shows: episode stills. */
	.stills {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
		gap: 16px;
	}

	.still {
		display: grid;
		gap: 3px;
		color: inherit;
		text-decoration: none;
	}

	.still-pic,
	.poster-pic {
		position: relative;
		display: block;
		overflow: hidden;
		border-radius: 10px;
		background: var(--surface-2);
	}

	.still-pic {
		aspect-ratio: 16 / 9;
	}

	.still-pic img,
	.poster-pic img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		transition: transform 0.4s ease;
	}

	.still:hover img,
	.poster:hover img,
	.ep:hover img {
		transform: scale(1.05);
	}

	.soon {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}

	.soon a {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 12px;
		align-items: center;
		padding: 6px 10px 6px 6px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--rule);
		color: inherit;
		text-decoration: none;
	}

	.soon a.with-poster {
		grid-template-columns: 38px minmax(0, 1fr) auto;
	}

	.soon img {
		width: 38px;
		height: 57px;
		object-fit: cover;
		border-radius: 4px;
	}

	.soon-words {
		display: grid;
		min-width: 0;
	}

	.soon-words > * {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.soon-day {
		font-weight: 600;
		color: var(--ink-soft);
	}

	/* Anime: the week as seven columns, today last and marked. */
	.week {
		display: grid;
		grid-template-columns: repeat(7, minmax(150px, 1fr));
		gap: 10px;
		overflow-x: auto;
		padding-bottom: 6px;
		scroll-snap-type: x proximity;
	}

	.week.loading,
	.posters.loading {
		min-height: 200px;
		border-radius: 10px;
		background: linear-gradient(90deg, var(--surface-2), var(--sunk), var(--surface-2));
		background-size: 200% 100%;
		animation: shimmer 1.6s linear infinite;
	}

	@keyframes shimmer {
		to {
			background-position: -200% 0;
		}
	}

	.day {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px;
		border-radius: 10px;
		background: var(--surface);
		border: 1px solid var(--rule);
		scroll-snap-align: start;
	}

	.day.today {
		border-color: var(--accent);
		box-shadow: inset 0 3px 0 var(--accent);
	}

	.day-name {
		margin: 0 0 2px;
		font-weight: 650;
		display: flex;
		justify-content: space-between;
		gap: 6px;
	}

	.day-name span {
		font-weight: 400;
		color: var(--ink-faint);
		font-size: 0.85rem;
	}

	.ep {
		display: grid;
		grid-template-columns: 40px 1fr;
		gap: 8px;
		align-items: center;
		color: inherit;
		text-decoration: none;
	}

	.ep img {
		width: 40px;
		height: 58px;
		object-fit: cover;
		border-radius: 5px;
		transition: transform 0.3s ease;
	}

	.ep-words {
		display: grid;
		min-width: 0;
		font-size: 0.85rem;
		line-height: 1.25;
	}

	.ep-words strong {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-weight: 600;
	}

	.ep-words span {
		color: var(--ink-faint);
	}

	.more {
		margin: 0;
		font-size: 0.85rem;
	}

	button.more {
		align-self: start;
		padding: 0;
		border: 0;
		background: none;
		color: var(--ink-soft);
		cursor: pointer;
	}

	button.more:hover {
		color: var(--ink);
		text-decoration: underline;
	}

	/* Films and shows: a row of posters. */
	.posters {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: clamp(130px, 15vw, 170px);
		gap: 14px;
		overflow-x: auto;
		padding-bottom: 8px;
		scroll-snap-type: x proximity;
	}

	.poster {
		display: grid;
		gap: 6px;
		align-content: start;
		color: inherit;
		text-decoration: none;
		scroll-snap-align: start;
	}

	.poster-pic {
		aspect-ratio: 2 / 3;
	}

	.poster strong {
		font-size: 0.9rem;
		font-weight: 600;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.owned {
		position: absolute;
		top: 8px;
		left: 8px;
		padding: 2px 7px;
		border-radius: 999px;
		background: var(--good);
		color: #fff;
		font-size: 0.7rem;
		font-weight: 600;
	}

	@media (max-width: 640px) {
		.hero {
			border-radius: 12px;
		}

		.update {
			grid-template-columns: 1fr;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.backdrops img { transition: none; }
		.backdrops img.on,
		.featured {
			animation: none;
		}
	}

	.cw-ctx-backdrop {
		position: fixed;
		inset: 0;
		z-index: 998;
	}

	.cw-ctx-menu {
		position: fixed;
		z-index: 999;
		min-width: 200px;
		padding: 6px;
		background: var(--surface);
		border: 1px solid var(--rule-firm);
		border-radius: 10px;
		box-shadow: 0 12px 32px rgb(0 0 0 / 50%);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.cw-ctx-menu button {
		text-align: left;
		padding: 7px 10px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--ink);
		font-size: 0.85rem;
		cursor: pointer;
	}

	.cw-ctx-menu button:hover {
		background: var(--surface-2);
	}

	.cw-ctx-menu hr {
		border: 0;
		border-top: 1px solid var(--rule);
		margin: 4px 0;
	}

	.cw-ctx-danger {
		color: var(--bad, #f87171) !important;
	}
</style>
