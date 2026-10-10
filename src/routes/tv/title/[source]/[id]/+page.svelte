<script lang="ts">
	import { playHref } from '$lib/tv/tiles';
	import { tvFocus } from '$lib/tvNav';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const d = $derived(data.details);
	// The library's name for it plays (it's what Showbox was matched by); else this page's.
	const playTitle = $derived(data.continuing?.title ?? data.entry?.title ?? d.title ?? '');
	const resumeLabel = $derived(
		data.continuing
			? data.type === 'tv' && data.continuing.season
				? `Resume S${data.continuing.season}E${data.continuing.episode}`
				: 'Resume'
			: 'Play'
	);
	const facts = $derived(
		[
			d.year,
			d.kind,
			d.seasons ? `${d.seasons} season${d.seasons === 1 ? '' : 's'}` : null,
			d.runtimeMinutes && data.type === 'movie' ? `${Math.floor(d.runtimeMinutes / 60)}h ${d.runtimeMinutes % 60}m`.replace(/^0h /, '') : null,
			d.externalRating ? `★ ${d.externalRating.toFixed(1)}` : null
		].filter(Boolean)
	);

	let inList = $state(false);
	let adding = $state(false);
	$effect(() => {
		inList = Boolean(data.entry);
	});

	async function addToList() {
		if (inList || adding) return;
		adding = true;
		try {
			const response = await fetch('/api/add', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ source: data.source, sourceId: data.id, status: 'planned' })
			});
			if (response.ok) inList = true;
		} catch {
		} finally {
			adding = false;
		}
	}

	/*
	 * A show's episodes, under the buttons as on Netflix: down from the buttons goes to the
	 * seasons, then the episodes (the page slides up to show them). OK on one plays it.
	 */
	type SeasonEpisode = {
		episode: number;
		name: string;
		still: string | null;
		airDate: string | null;
		runtime: number | null;
		overview: string | null;
		progress: number;
	};
	let season = $state(0);
	let seasonEps = $state<SeasonEpisode[]>([]);
	let loadingEps = $state(false);
	let down = $state(false);
	$effect(() => {
		season = data.show?.season ?? 0;
	});
	$effect(() => {
		const show = data.show;
		const wanted = season;
		if (!show || !wanted) return;
		loadingEps = true;
		const params = new URLSearchParams({ show: String(show.showId), season: String(wanted), title: playTitle });
		fetch(`/api/tv/season?${params}`)
			.then((response) => response.json())
			.then((result) => {
				if (season === wanted) seasonEps = result.episodes ?? [];
			})
			.catch(() => {
				if (season === wanted) seasonEps = [];
			})
			.finally(() => {
				if (season === wanted) loadingEps = false;
			});
	});

	const today = new Date().toISOString().slice(0, 10);
	const aired = (ep: SeasonEpisode) => !ep.airDate || ep.airDate <= today;
	const airsOn = (date: string) =>
		new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

	let playButton: HTMLElement | undefined = $state();
	$effect(() => {
		if (playButton) requestAnimationFrame(() => tvFocus(playButton!));
	});
</script>

<svelte:head><title>{d.title} · Catalog</title></svelte:head>

<div class="title-screen" class:down>
	{#if d.backdropUrl || d.posterUrl}
		<img class="art" class:poster-art={!d.backdropUrl} src={d.backdropUrl ?? d.posterUrl} alt="" />
	{/if}
	<div class="shade"></div>

	<div class="slide">
	<div class="about" onfocusin={() => (down = false)}>
		<h1>{d.title}</h1>
		{#if facts.length}<p class="facts">{facts.join(' · ')}</p>{/if}
		{#if data.continuing?.progress}
			<p class="progress">
				<span class="bar"><span class="fill" style:width="{Math.max(3, data.continuing.progress * 100)}%"></span></span>
				{#if data.continuing.left}<span>{data.continuing.left} min left</span>{/if}
			</p>
		{/if}
		{#if d.overview}<p class="overview">{d.overview}</p>{/if}

		<div class="buttons" data-tv-row>
			{#if d.unreleased}
				<span class="soon">Not out yet</span>
			{:else}
				<a
					bind:this={playButton}
					class="button primary"
					data-tv-item
					data-tv-autofocus
					href={playHref(playTitle, data.type, data.continuing ? null : d.year, data.continuing?.season, data.continuing?.episode)}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" /></svg>
					{resumeLabel}
				</a>
				{#if data.continuing && data.type === 'tv'}
					<a class="button" data-tv-item href={playHref(playTitle, data.type, null, 1, 1)}>From the start</a>
				{/if}
			{/if}
			<button type="button" class="button" data-tv-item onclick={addToList} disabled={adding}>
				{inList ? '✓ My List' : adding ? 'Adding…' : '+ My List'}
			</button>
		</div>
	</div>

	{#if data.show && !d.unreleased}
		<section class="episodes" onfocusin={() => (down = true)}>
			{#if data.show.seasons.length > 1}
				<div class="seasons" data-tv-row data-tv-strip>
					{#each data.show.seasons as one (one.number)}
						<button type="button" class="chip" class:on={season === one.number} data-tv-item onclick={() => (season = one.number)}>
							Season {one.number}
						</button>
					{/each}
				</div>
			{:else}
				<h2>Episodes</h2>
			{/if}
			{#if seasonEps.length}
				<div class="eps" data-tv-row data-tv-strip>
					{#each seasonEps as ep (ep.episode)}
						{#if aired(ep)}
							<a class="ep" data-tv-item href={playHref(playTitle, 'tv', data.continuing ? null : d.year, season, ep.episode)}>
								<span class="still">
									{#if ep.still}<img src={ep.still} alt="" loading="lazy" />{/if}
									{#if ep.progress > 0}
										<span class="ep-bar"><span class="ep-fill" style:width="{Math.max(4, ep.progress * 100)}%"></span></span>
									{/if}
								</span>
								<span class="ep-name">{ep.episode}. {ep.name}</span>
								{#if ep.runtime}<span class="ep-meta">{ep.runtime}m</span>{/if}
							</a>
						{:else}
							<span class="ep later">
								<span class="still"><span class="airs">{airsOn(ep.airDate!)}</span></span>
								<span class="ep-name">{ep.episode}. {ep.name}</span>
							</span>
						{/if}
					{/each}
				</div>
			{:else if loadingEps}
				<p class="eps-note">Loading episodes…</p>
			{/if}
		</section>
	{/if}
	</div>
</div>

<style>
	.title-screen {
		position: absolute;
		inset: 0;
	}

	.art {
		position: absolute;
		inset: 0 0 0 auto;
		width: 75%;
		height: 100%;
		object-fit: cover;
		opacity: 0.6;
	}

	/* Only a poster: smaller, on the right, not stretched across. */
	.art.poster-art {
		width: 38%;
		object-position: center 20%;
		opacity: 0.5;
	}

	.shade {
		position: absolute;
		inset: 0;
		background:
			linear-gradient(90deg, var(--paper) 35%, transparent 80%),
			linear-gradient(0deg, var(--paper) 0%, transparent 40%);
	}

	/* Everything on the page; it slides up to show the episodes while they're highlighted. */
	.slide {
		position: relative;
		transition: transform 0.25s ease;
	}

	.title-screen.down .slide {
		transform: translateY(-52vh);
	}

	.about {
		position: relative;
		min-height: 80vh;
		box-sizing: border-box;
		max-width: 55%;
		padding: 12vh 0 0 1vw;
		display: flex;
		flex-direction: column;
		gap: 1.3vw;
	}

	h1 {
		margin: 0;
		font-family: var(--display);
		font-size: 4vw;
		line-height: 1.05;
	}

	.facts {
		margin: 0;
		font-size: 1.5vw;
		font-weight: 600;
		color: var(--ink-soft);
	}

	.progress {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 1vw;
		font-size: 1.3vw;
		color: var(--ink-soft);
	}

	.bar {
		width: 16vw;
		height: 0.45vw;
		border-radius: 1vw;
		background: rgb(255 255 255 / 20%);
		overflow: hidden;
	}

	.fill {
		display: block;
		height: 100%;
		background: var(--accent);
	}

	.overview {
		margin: 0;
		font-size: 1.45vw;
		line-height: 1.5;
		color: var(--ink-soft);
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 5;
		line-clamp: 5;
		overflow: hidden;
	}

	.buttons {
		display: flex;
		gap: 1.2vw;
		margin-top: 1vw;
	}

	.button {
		display: inline-flex;
		align-items: center;
		gap: 0.8vw;
		padding: 1vw 2vw;
		border: none;
		border-radius: 0.6vw;
		background: rgb(255 255 255 / 14%);
		color: var(--ink);
		font: inherit;
		font-size: 1.6vw;
		font-weight: 700;
		text-decoration: none;
		cursor: pointer;
		outline: none;
		transition: transform 0.12s ease;
	}

	.button svg {
		width: 1.8vw;
		height: 1.8vw;
		fill: currentColor;
	}

	/* Highlighted: white with dark text, like Netflix's. */
	.button:focus,
	.button:global(.tv-focused) {
		background: var(--ink);
		color: var(--paper);
		transform: scale(1.06);
	}

	.episodes {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 1vw;
		padding: 0 0 0 1vw;
	}

	.episodes h2 {
		margin: 0;
		font-size: 1.7vw;
	}

	/* A long-running show's many seasons scroll along, like the episodes. */
	.seasons {
		display: flex;
		gap: 1vw;
		overflow: hidden;
		padding: 0.4vw 3vw 0.4vw 0.8vw;
		margin-left: -0.8vw;
	}

	.chip {
		padding: 0.6vw 1.5vw;
		border: none;
		border-radius: 100vw;
		background: rgb(255 255 255 / 10%);
		color: var(--ink-soft);
		font: inherit;
		font-size: 1.35vw;
		font-weight: 700;
		white-space: nowrap;
		flex: none;
		cursor: pointer;
		outline: none;
	}

	.chip.on {
		color: var(--accent);
		box-shadow: inset 0 0 0 0.15vw var(--accent);
	}

	.chip:focus,
	.chip:global(.tv-focused) {
		background: var(--ink);
		color: var(--paper);
	}

	/* Room around for a highlighted episode to grow into; it scrolls by itself. */
	.eps {
		display: flex;
		gap: 1.4vw;
		overflow: hidden;
		padding: 1.2vw 3vw 1.5vw 0.8vw;
		margin-left: -0.8vw;
	}

	.ep {
		flex: none;
		width: 18vw;
		display: flex;
		flex-direction: column;
		gap: 0.5vw;
		color: var(--ink);
		text-decoration: none;
		outline: none;
	}

	.still {
		position: relative;
		display: grid;
		place-items: center;
		aspect-ratio: 16 / 9;
		border-radius: 0.5vw;
		overflow: hidden;
		background: var(--surface-2);
		transition: transform 0.15s ease, box-shadow 0.15s ease;
		transform-origin: center bottom;
	}

	.still img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.ep:focus .still,
	.ep:global(.tv-focused) .still {
		transform: scale(1.06);
		box-shadow: 0 0 0 0.3vw var(--ink);
	}

	.ep:focus .ep-name,
	.ep:global(.tv-focused) .ep-name {
		color: var(--accent);
	}

	.ep-bar {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 0.4vw;
		background: rgb(255 255 255 / 25%);
	}

	.ep-fill {
		display: block;
		height: 100%;
		background: var(--accent);
	}

	.ep-name {
		font-size: 1.25vw;
		font-weight: 600;
		line-height: 1.25;
		overflow: hidden;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.ep-meta,
	.eps-note {
		margin: 0;
		font-size: 1.1vw;
		color: var(--ink-soft);
	}

	/* Not out yet: shown, but nothing to pick. */
	.ep.later {
		opacity: 0.45;
	}

	.airs {
		font-size: 1.3vw;
		font-weight: 700;
		color: var(--ink-soft);
	}

	.soon {
		font-size: 1.5vw;
		color: var(--ink-faint);
	}
</style>
