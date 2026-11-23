<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import TvRow from '$lib/tv/TvRow.svelte';
	import TvCard from '$lib/tv/TvCard.svelte';
	import { fromContinue, type Tile } from '$lib/tv/tiles';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	type List = Awaited<PageData['lists']['anime']>;
	type Item = List['items'][number];
	type Name = 'watchList' | 'yours' | 'soon' | 'anime' | 'streaming' | 'cinemas' | 'shows';
	const sections: { key: Name; label: string }[] = [
		{ key: 'watchList', label: 'From your watch list' },
		{ key: 'yours', label: 'New episodes of your shows' },
		{ key: 'soon', label: 'Coming up' },
		{ key: 'anime', label: 'Anime this week' },
		{ key: 'streaming', label: 'New to stream' },
		{ key: 'cinemas', label: 'In cinemas' },
		{ key: 'shows', label: 'New shows' }
	];
	let lists = $state<Partial<Record<Name, List>>>({});
	let selected = $state<string | null>(null);
	let continueTiles = $state<Tile[]>([]);
	const all = $derived(Object.values(lists).flatMap((list) => list?.items ?? []));
	const hero = $derived([...new Map(all.map((item) => [item.href, item])).values()]
		.sort((a, b) => b.popularity - a.popularity).slice(0, 6));
	const continuing = $derived(continueTiles.find((item) => item.href === selected));
	const featured = $derived(continuing ? { ...continuing, backdrop: null, overview: continuing.overview ?? '', date: '', what: continuing.meta }
		: all.find((item) => item.href === selected) ?? hero[0]);
	const pending = $derived(sections.some((section) => !lists[section.key]));

	$effect(() => {
		const incoming = data.lists;
		const yours = data.yours;
		const watchList = data.watchList;
		const resume = data.continueWatching;
		let stale = false;
		lists = {};
		continueTiles = [];
		watchList.then((result) => { if (!stale) lists.watchList = result; });
		resume.then((items) => { if (!stale) continueTiles = items.map((item) => fromContinue(item)); });
		for (const key of ['anime', 'streaming', 'cinemas', 'shows'] as const) {
			incoming[key].then((result) => { if (!stale) lists[key] = result; });
		}
		yours.then((result) => {
			if (!stale) {
				lists.yours = { items: result.out, failed: result.failed };
				lists.soon = { items: result.soon, failed: false };
			}
		});
		return () => { stale = true; };
	});

	function moveSlide(direction: number) {
		if (hero.length < 2) return;
		const index = Math.max(0, hero.findIndex((item) => item.href === featured?.href));
		selected = hero[(index + direction + hero.length) % hero.length].href;
	}
	const carousel = (el: HTMLElement) => {
		const move = (event: Event) => moveSlide((event as CustomEvent<number>).detail);
		el.addEventListener('catalog:tv-slide', move);
		return () => el.removeEventListener('catalog:tv-slide', move);
	};
	const day = (date: string) => date === data.week.today ? 'Today'
		: new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
	const short = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	function itemsFor(key: Name): Item[] {
		const items = lists[key]?.items ?? [];
		return key === 'anime' ? [...items].sort((a, b) =>
			Number(b.date === data.week.today) - Number(a.date === data.week.today) || b.date.localeCompare(a.date)) : items;
	}
	export const snapshot = {
		capture: () => selected,
		restore: (href: string | null) => { selected = href; }
	};
	onMount(() => {
		try {
			localStorage.setItem('catalog:thisWeekOpened', String(Date.now()));
			window.dispatchEvent(new Event('catalog:thisWeekSeen'));
		} catch {}
	});
</script>

<svelte:head><title>Home · Catalog</title></svelte:head>

<div class="screen">
	<header class="hero" data-tv-row>
		{#if featured?.backdrop || featured?.poster}<img class="art" src={featured.backdrop ?? featured.poster} alt="" />{/if}
		<div class="shade"></div>
		<button type="button" class="featured" data-tv-item data-tv-autofocus data-tv-carousel={hero.length > 1 || undefined}
			aria-disabled={!featured} aria-label={featured ? `Open ${featured.title}` : 'Home'}
			onclick={() => { if (featured) goto(featured.href); }} {@attach carousel}>
			<span class="eyebrow">{short(data.week.start)} – {short(data.week.today)}</span>
			<span class="heading">Home</span>
			<strong>{featured?.title ?? (pending ? 'Loading…' : 'Nothing new this week.')}</strong>
			{#if featured}<span class="meta">{featured.date ? `${day(featured.date)} · ` : ''}{featured.what}</span>{/if}
			{#if featured?.overview}<span class="overview">{featured.overview}</span>{/if}
			{#if hero.length > 1}
				<span class="slides" aria-hidden="true">‹
					<span class="dots">{#each hero as item (item.href)}<span class:on={item.href === featured?.href}></span>{/each}</span>
					›</span>
			{/if}
		</button>
	</header>
	<div class="window">
		<div class="track" data-tv-track>
			{#if continueTiles.length}
				<TvRow label="Continue watching">
					{#each continueTiles as item (item.key)}
						<TvCard href={item.href} title={item.title} poster={item.poster} note={item.note} noteNew={item.noteNew}
							progress={item.progress} menu={item.menu} showTitle onfocus={() => (selected = item.href)} />
					{/each}
				</TvRow>
			{/if}
			{#each sections as section (section.key)}
				{@const result = lists[section.key]}
				{#if !result}
					<section class="loading"><h2>{section.label}</h2><p>Loading…</p></section>
				{:else if result.items.length || result.failed}
					<TvRow label={section.label}>
						{#if result.failed}
							<div class="failure"><p>Couldn't load.</p><button type="button" data-tv-item onclick={() => invalidateAll()}>Try again</button></div>
						{/if}
						{#each itemsFor(section.key) as item (item.key)}
							<TvCard href={item.href} title={item.title} poster={item.poster} showTitle
									note={`${section.key === 'watchList' ? short(item.date) : day(item.date)} · ${item.what}`} onfocus={() => (selected = item.href)} />
						{/each}
					</TvRow>
				{/if}
			{/each}
			<div class="end"></div>
		</div>
	</div>
</div>

<style>
	.screen { position: absolute; inset: 0; display: flex; flex-direction: column; }
	.hero { position: relative; flex: none; height: 44vh; overflow: hidden; }
	.art { position: absolute; inset: 0 0 0 auto; width: 65%; height: 100%; object-fit: cover; opacity: 0.55; }
	.shade { position: absolute; inset: 0; background: linear-gradient(90deg, var(--paper) 25%, transparent 85%), linear-gradient(0deg, var(--paper), transparent 65%); }
	.featured { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 0.4vw; width: 64%; margin: 1vh 1vw; padding: 1vw; border: 0.2vw solid transparent; border-radius: 0.6vw; background: transparent; color: var(--ink); text-align: left; }
	.featured:focus, .featured:global(.tv-focused) { border-color: var(--ink); outline: none; }
	.eyebrow { font-size: 1.1vw; text-transform: uppercase; letter-spacing: 0.12em; }
	.heading { font-family: var(--display); font-size: 2.2vw; line-height: 1.1; }
	strong { font-family: var(--display); font-size: 2.6vw; line-height: 1.1; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
	.meta { font-size: 1.1vw; color: var(--ink-soft); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.overview { font-size: 1.15vw; line-height: 1.4; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
	.slides, .dots { display: flex; align-items: center; gap: 0.6vw; }
	.slides { font-size: 1.5vw; }
	.dots span { width: 0.4vw; height: 0.4vw; border-radius: 50%; background: var(--ink-faint); }
	.dots span.on { background: var(--ink); }
	.window { position: relative; flex: 1; overflow: hidden; padding-left: 1vw; }
	.track { position: relative; display: flex; flex-direction: column; gap: 0.6vw; transition: transform 0.25s ease; }
	.end { height: 40vh; flex: none; }
	h2 { font-size: 1.7vw; }
	.loading, .failure { font-size: 1.4vw; color: var(--ink-soft); }
	.failure { flex: none; min-width: 13vw; padding: 1vw; }
	.failure button { font-size: 1.4vw; padding: 0.7vw 1.2vw; }
	.failure button:focus, .failure button:global(.tv-focused) { outline: 0.3vw solid var(--ink); }
	@media (prefers-reduced-motion: reduce) { .track { transition: none; } }
</style>
