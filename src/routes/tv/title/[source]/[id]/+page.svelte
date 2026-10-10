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

	let playButton: HTMLElement | undefined = $state();
	$effect(() => {
		if (playButton) requestAnimationFrame(() => tvFocus(playButton!));
	});
</script>

<svelte:head><title>{d.title} · Catalog</title></svelte:head>

<div class="title-screen">
	{#if d.backdropUrl || d.posterUrl}
		<img class="art" class:poster-art={!d.backdropUrl} src={d.backdropUrl ?? d.posterUrl} alt="" />
	{/if}
	<div class="shade"></div>

	<div class="about">
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

	.about {
		position: relative;
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

	.soon {
		font-size: 1.5vw;
		color: var(--ink-faint);
	}
</style>
