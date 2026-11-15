<script lang="ts">
	import { page } from '$app/state';
	import { p } from '$lib/altText';
	import type { SearchResult } from '$lib/server/metadata/types';

	/**
	 * Browse → Random: asks film, series or anime (the part of Browse you're in is first), then
	 * shows one well-known title (src/routes/api/browse/random), with Open and Another one.
	 * Only popular titles many people rated: something the sources will have.
	 */
	type Kind = 'movies' | 'tv' | 'anime';
	let { cat = '', genre = null, genreName = '' }: { cat?: string; genre?: number | null; genreName?: string } = $props();

	const KINDS: { value: Kind; label: string }[] = [
		{ value: 'movies', label: 'Movie' },
		{ value: 'tv', label: 'TV show' },
		{ value: 'anime', label: 'Anime' }
	];

	let open = $state(false);
	let kind = $state<Kind>('movies');
	let useGenre = $state(true);
	let pick = $state<SearchResult | null>(null);
	let looking = $state(false);
	let problem = $state('');
	let box = $state<HTMLDivElement | null>(null);

	const t = (text: string) => (page.data.altMode ? p(text) : text);
	const here = $derived(page.url.pathname + page.url.search);

	function toggle(event: MouseEvent) {
		event.stopPropagation();
		open = !open;
		if (open) {
			// The part of Browse you're in comes first (anime while browsing anime).
			kind = cat === 'tv' || cat === 'anime' ? cat : 'movies';
			pick = null;
			problem = '';
		}
	}

	async function roll(which: Kind) {
		kind = which;
		looking = true;
		problem = '';
		const params = new URLSearchParams({ kind: which });
		if (genre && useGenre) params.set('genre', String(genre));
		try {
			const answer = await fetch(`/api/browse/random?${params}`).then((r) => (r.ok ? r.json() : null));
			pick = answer?.pick ?? null;
			if (!pick) problem = t('Nothing came back. Try again in a moment.');
		} catch {
			problem = t('Nothing came back. Try again in a moment.');
		}
		looking = false;
	}

	const link = (result: SearchResult) => `/title/${result.source}/${encodeURIComponent(result.sourceId)}?back=${encodeURIComponent(here)}`;

	// Closes when clicked outside, like Browse's filter.
	$effect(() => {
		if (!open) return;
		const away = (event: MouseEvent) => {
			if (box && !box.contains(event.target as Node)) open = false;
		};
		document.addEventListener('click', away);
		return () => document.removeEventListener('click', away);
	});
</script>

<div class="random-wrap" bind:this={box}>
	<button type="button" class="btn" aria-expanded={open} onclick={toggle}>{t('Random')}</button>

	{#if open}
		<div class="random-panel" role="dialog" aria-label="Random">
			<span class="faint small">{t('Pick a random…')}</span>
			<div class="kinds">
				{#each KINDS as option (option.value)}
					<button type="button" class="btn" class:btn-primary={kind === option.value} onclick={() => roll(option.value)} disabled={looking}>
						{t(option.label)}
					</button>
				{/each}
			</div>
			{#if genre && genreName}
				<label class="toggle small">
					<input type="checkbox" bind:checked={useGenre} />
					{t('Only')} {genreName}
				</label>
			{/if}

			{#if looking}
				<p class="faint small">…</p>
			{:else if pick}
				<div class="pick">
					<a href={link(pick)} class="poster">
						{#if pick.posterUrl}<img src={pick.posterUrl} alt="" />{/if}
					</a>
					<div class="about">
						<a href={link(pick)} class="title">{pick.title}</a>
						<span class="faint small">{pick.year ?? ''}{pick.externalRating ? ` · ★ ${pick.externalRating.toFixed(1)}` : ''}</span>
						{#if pick.overview}<p class="overview small">{pick.overview}</p>{/if}
						<div class="row">
							<a href={link(pick)} class="btn btn-primary">{t('Open')}</a>
							<button type="button" class="btn" onclick={() => roll(kind)}>{t('Another one')}</button>
						</div>
					</div>
				</div>
			{:else if problem}
				<p class="msg bad small">{problem}</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.random-wrap {
		position: relative;
	}

	.random-panel {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 50;
		width: min(360px, calc(100vw - 32px));
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px 14px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.25);
	}

	.kinds,
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.pick {
		display: flex;
		gap: 12px;
	}

	.poster img {
		display: block;
		width: 80px;
		border-radius: var(--radius-sm);
	}

	.about {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.title {
		font-weight: 600;
	}

	.title:hover {
		color: var(--accent);
	}

	.overview {
		margin: 0;
		display: -webkit-box;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.small {
		font-size: 0.82rem;
	}
</style>
