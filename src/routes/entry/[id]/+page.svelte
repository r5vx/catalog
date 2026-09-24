<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import BackBar from '$lib/BackBar.svelte';
	import EntryForm from '$lib/EntryForm.svelte';
	import TitleSearch from '$lib/TitleSearch.svelte';
	import ScoreStrip from '$lib/ScoreStrip.svelte';
	import Synopsis from '$lib/Synopsis.svelte';
	import TagChips from '$lib/TagChips.svelte';
	import CastRow from '$lib/CastRow.svelte';
	import WhereToWatch from '$lib/WhereToWatch.svelte';
	import { showbox } from '$lib/showboxHealth.svelte';
	import { progressSummary } from '$lib/progress';
	import { statusLabel } from '$lib/constants';
	import { money } from '$lib/format';
	import { p } from '$lib/poison';
	import type { SearchResult } from '$lib/server/metadata/types';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const pm = $derived(page.data.poisonMode);

	let busyKey = $state<string | null>(null);
	let showWatchElsewhere = $state(false);

	onMount(() => {
		showbox.check();
		if (page.url.searchParams.get('edit') === '1') {
			const el = document.querySelector<HTMLDetailsElement>('.editor');
			if (el) {
				el.open = true;
				requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth' }));
			}
		}
	});

	const entry = $derived(data.entry);

	const category = $derived(
		data.categories.find((one) => one.id === entry.categoryId) ?? null
	);

	const isAnime = $derived(category?.slug === 'anime' || entry.source === 'anilist');
	const isMovie = $derived(category?.slug === 'movies');

	const added = $derived(
		new Date(entry.createdAt).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		})
	);

	/* ------------------------------------- things fetched after the page loads */

	/**
	 * The synopsis, the outside scores, and — for entries added before the app
	 * kept them — the tags and cast.
	 *
	 * Fetched after the page has rendered rather than during the load, so a
	 * slow API never keeps you staring at a blank screen. Everything is saved,
	 * so it only happens once per title.
	 */
	let overview = $state<string | null>(null);
	let tags = $state<{ id?: number; name: string; kind: string }[]>([]);
	let cast = $state<{ id: number; name: string; photo: string | null; character: string | null }[]>(
		[]
	);
	let scores = $state<{
		imdbRating: number | null;
		imdbVotes: number | null;
		rtScore: number | null;
		metascore: number | null;
		contentRating: string | null;
		awards: string | null;
		boxOffice: number | null;
	} | null>(null);

	let looking = $state(false);

	// Declared after `scores` because box office only arrives with them.
	const facts = $derived(
		[
			entry.year ? String(entry.year) : null,
			category?.name ?? null,
			entry.episodesTotal ? `${entry.episodesTotal} episodes` : null,
			entry.runtimeMinutes ? `${entry.runtimeMinutes} min` : null,
			entry.rewatches ? `Watched ${entry.rewatches + 1}×` : null,
			money(scores?.boxOffice)
		].filter(Boolean)
	);

	$effect(() => {
		const current = entry;

		// Seed from what's stored, then go and get whatever's missing.
		overview = current.overview;
		tags = data.tags;
		cast = data.cast;
		scores = {
			imdbRating: current.imdbRating,
			imdbVotes: current.imdbVotes,
			rtScore: current.rtScore,
			metascore: current.metascore,
			contentRating: current.contentRating,
			awards: current.awards,
			boxOffice: current.boxOffice
		};

		const wantScores = data.scoresAvailable && !current.scoresCheckedAt;
		const wantDetails = !current.overview;

		if (!wantScores && !wantDetails) return;
		if (!current.sourceId) return;

		enrich(current.id);
	});

	async function enrich(id: number) {
		looking = true;

		try {
			const response = await fetch('/api/scores', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});

			if (!response.ok) return;

			const payload = await response.json();
			scores = payload.scores;
			if (payload.overview) overview = payload.overview;
			if (payload.tags?.length) tags = payload.tags;
			if (payload.cast?.length) cast = payload.cast;
		} catch {
			// Offline. What's stored is already on screen.
		} finally {
			looking = false;
		}
	}

	/* --------------------------------------------------------- the wrong match */

	async function useInstead(result: SearchResult) {
		busyKey = result.key;
		try {
			const response = await fetch('/api/rematch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: entry.id, result })
			});

			if (!response.ok) return;

			// A full reload, not invalidateAll(): the form holds its own copies of
			// every field, so it has to be rebuilt from the new data. Without this
			// the old poster sits in the form and saving would write it back.
			location.reload();
		} finally {
			busyKey = null;
		}
	}
</script>

<svelte:head><title>{entry.title} · {pm ? "Papa's Giblets" : 'Catalog'}</title></svelte:head>

<BackBar />

{#if form?.error}
	<p class="notice error" role="alert">{form.error}</p>
{:else if form?.saved}
	<p class="notice saved" role="status">{pm ? p('Saved.') : 'Saved.'}</p>
{:else if form?.refreshed}
	<p class="notice saved" role="status">
		Refreshed — {form.refreshed} cast {form.refreshed === 1 ? 'member' : 'members'}, tags and
		synopsis are up to date.
	</p>
{/if}

<article>
	<header>
		<div class="poster">
			{#if entry.posterUrl}
				<img src={entry.posterUrl} alt="" />
			{:else}
				<span class="empty" aria-hidden="true">{category?.emoji ?? '?'}</span>
			{/if}
		</div>

		<div class="meta">
			<div class="pills">
				<span class="pill {entry.status}">{pm ? p(statusLabel(entry.status)) : statusLabel(entry.status)}</span>
				{#if entry.favorite}<span class="pill fav">{pm ? '★ Finch approved' : '★ Favourite'}</span>{/if}
				<a
					href="/watch?title={encodeURIComponent(entry.title)}&type={category?.slug === 'movies' ? 'movie' : 'tv'}{entry.year ? `&year=${entry.year}` : ''}&auto=1"
					class="pill watch"
					class:disabled={!showbox.up}
					title={showbox.up ? 'Watch now' : 'showbox.media is down'}
				>{pm ? p('▶ Watch') : '▶ Watch'}</a>
				<span class="watch-elsewhere-wrap">
					<button class="pill watch-elsewhere" onclick={() => showWatchElsewhere = !showWatchElsewhere}>
						Watch elsewhere ▾
					</button>
					{#if showWatchElsewhere}
						<div class="watch-elsewhere-menu">
							<a
								class="watch-elsewhere-item"
								class:disabled={isMovie}
								href={isMovie ? undefined : `https://www.miruro.tv/search?query=${encodeURIComponent(entry.title)}`}
								target="_blank"
								rel="noopener"
								onclick={() => showWatchElsewhere = false}
							>
								Miruro
								<span class="watch-elsewhere-note">{isMovie ? 'Anime only' : 'Anime'}</span>
							</a>
							<a
								class="watch-elsewhere-item"
								class:disabled={isAnime}
								href={isAnime ? undefined : `https://cinejoy.pk/search/${encodeURIComponent(entry.title)}`}
								target="_blank"
								rel="noopener"
								onclick={() => showWatchElsewhere = false}
							>
								CineJoy
								<span class="watch-elsewhere-note">{isAnime ? 'Movies & TV only' : 'Movies & TV'}</span>
							</a>
						</div>
					{/if}
				</span>
			</div>

			<h1>{entry.title}</h1>
			<p class="facts faint tabular">{facts.join(' · ')}</p>

			<ScoreStrip
				mine={entry.rating}
				site={entry.externalRating}
				siteName={entry.source === 'anilist' ? 'AniList' : 'TMDB'}
				{...entry.source === 'anilist' ? {} : { siteVotes: entry.externalVotes }}
				imdb={scores?.imdbRating ?? null}
				imdbVotes={scores?.imdbVotes ?? null}
				rt={scores?.rtScore ?? null}
				metascore={scores?.metascore ?? null}
				contentRating={scores?.contentRating ?? null}
				loading={looking}
			/>

			{#if progressSummary(entry)}
				<p class="airing muted">{progressSummary(entry)}</p>
			{/if}

			{#if entry.notes}
				<blockquote class="yours">{entry.notes}</blockquote>
			{/if}
		</div>
	</header>

	<Synopsis text={overview} pending={looking} />

	{#if entry.sourceId}
		<WhereToWatch entryId={entry.id} />
	{/if}

	{#if scores?.awards}
		<section>
			<h2 class="label">Awards</h2>
			<p class="awards muted">{scores.awards}</p>
		</section>
	{/if}

	<TagChips {tags} />

	<CastRow {cast} back="/entry/{entry.id}" />

	<!-- Closed by default: opening a film should show you the film, not a
	     wall of empty text boxes. -->
	<details class="editor">
		<summary>
			<span class="summary-title">{pm ? p('Edit') : 'Edit'}</span>
			<span class="summary-sub faint">rating, status, dates, your own notes</span>
		</summary>

		<div class="editor-body">
			<form method="POST" action="?/save">
				<EntryForm categories={data.categories} {entry} submitLabel="Save changes" />
			</form>

			<form method="POST" action="?/refresh" class="sub-tool">
				<div>
					<p class="tool-title">Out of date?</p>
					<p class="faint hint">Fetch the synopsis, tags, cast and scores again.</p>
				</div>
				<button type="submit" class="btn">Refresh from the database</button>
			</form>

			<div class="sub-tool">
				<div>
					<p class="tool-title">Wrong match?</p>
					<p class="faint hint">Your rating and notes are kept.</p>
				</div>
				<TitleSearch
					initial={entry.title}
					label="Find the right title"
					placeholder="Search for the right one…"
					{busyKey}
					onpick={useInstead}
				/>
			</div>

			<form
				method="POST"
				action="?/delete"
				class="sub-tool danger"
				onsubmit={(event) => {
					if (!confirm(`Remove "${entry.title}" from your library?`)) event.preventDefault();
				}}
			>
				<div>
					<p class="tool-title">Remove it</p>
					<p class="faint hint">Added {added}.</p>
				</div>
				<button type="submit" class="btn btn-danger">{pm ? p('Delete this entry') : 'Delete this entry'}</button>
			</form>
		</div>
	</details>
</article>

<style>
	.back {
		font-size: 0.85rem;
		display: inline-block;
		margin-bottom: 14px;
	}

	.back:hover {
		color: var(--accent);
	}

	.notice {
		border-radius: var(--radius-sm);
		padding: 10px 14px;
		margin: 0 0 18px;
		font-size: 0.9rem;
	}

	.error {
		background: var(--accent-bg);
		border: 1px solid var(--accent);
		color: var(--accent);
	}

	.saved {
		background: var(--good-bg);
		border: 1px solid var(--good);
		color: var(--good);
	}

	article {
		display: flex;
		flex-direction: column;
		gap: 30px;
	}

	header {
		display: flex;
		gap: 24px;
		align-items: flex-start;
	}

	.poster {
		flex: 0 0 190px;
		aspect-ratio: 2 / 3;
		background: var(--surface-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		overflow: hidden;
		display: grid;
		place-items: center;
	}

	.poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.empty {
		font-size: 2.4rem;
		opacity: 0.4;
	}

	.meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.pill.fav {
		background: var(--accent-bg);
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 35%, transparent);
	}

	.pill.watch {
		background: var(--good);
		color: var(--paper);
		border-color: var(--good);
		cursor: pointer;
		text-decoration: none;
	}

	.pill.watch:hover {
		filter: brightness(1.12);
	}

	.pill.watch.disabled {
		opacity: 0.35;
		pointer-events: none;
	}

	.watch-elsewhere-wrap {
		position: relative;
		display: inline-block;
	}

	.pill.watch-elsewhere {
		background: var(--sunk);
		color: var(--ink-soft);
		border: 1px solid var(--rule);
		cursor: pointer;
		font: inherit;
		font-size: inherit;
	}

	.pill.watch-elsewhere:hover {
		background: var(--hover);
	}

	.watch-elsewhere-menu {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 20;
		min-width: 180px;
		background: var(--paper);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		padding: 4px 0;
	}

	.watch-elsewhere-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 14px;
		text-decoration: none;
		color: var(--ink);
		font-size: 0.88rem;
		cursor: pointer;
	}

	.watch-elsewhere-item:hover:not(.disabled) {
		background: var(--hover);
	}

	.watch-elsewhere-item.disabled {
		opacity: 0.35;
		pointer-events: none;
	}

	.watch-elsewhere-note {
		font-size: 0.74rem;
		color: var(--ink-soft);
	}

	h1 {
		font-size: clamp(1.6rem, 4.5vw, 2.3rem);
		margin: -4px 0 0;
	}

	.facts {
		margin: -6px 0 0;
		font-size: 0.87rem;
	}

	.airing {
		font-size: 0.9rem;
		margin: 2px 0 0;
		padding-left: 11px;
		border-left: 2px solid var(--good);
	}

	/* Your own words about it, which outrank anything a database says. */
	.yours {
		margin: 2px 0 0;
		padding-left: 13px;
		border-left: 2px solid var(--accent);
		font-size: 0.93rem;
		line-height: 1.6;
		color: var(--ink-soft);
		white-space: pre-wrap;
		max-width: 62ch;
	}

	.label {
		font-family: var(--body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin: 0 0 8px;
	}

	.awards {
		margin: 0;
		font-size: 0.92rem;
		max-width: 68ch;
	}

	/* ------------------------------------------------------------- editing */

	.editor {
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.editor summary {
		display: flex;
		align-items: baseline;
		gap: 10px;
		flex-wrap: wrap;
		padding: 14px 18px;
		cursor: pointer;
		list-style: none;
	}

	.editor summary::-webkit-details-marker {
		display: none;
	}

	/* A caret that turns, drawn rather than imported. */
	.editor summary::before {
		content: '';
		width: 7px;
		height: 7px;
		border-right: 2px solid var(--ink-faint);
		border-bottom: 2px solid var(--ink-faint);
		transform: rotate(-45deg);
		transition: transform 0.15s ease;
		flex: none;
		align-self: center;
	}

	.editor[open] summary::before {
		transform: rotate(45deg);
	}

	.editor summary:hover .summary-title {
		color: var(--accent);
	}

	.summary-title {
		font-weight: 600;
	}

	.summary-sub {
		font-size: 0.83rem;
	}

	.editor-body {
		padding: 4px 18px 20px;
		display: flex;
		flex-direction: column;
		gap: 26px;
	}

	.sub-tool {
		border-top: 1px solid var(--rule);
		padding-top: 18px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.sub-tool.danger,
	form.sub-tool {
		align-items: flex-start;
	}

	.tool-title {
		font-weight: 600;
		margin: 0;
		font-size: 0.93rem;
	}

	.hint {
		font-size: 0.8rem;
		margin: 2px 0 0;
	}

	@media (max-width: 620px) {
		header {
			flex-direction: column;
			gap: 18px;
		}

		.poster {
			flex: none;
			width: 150px;
		}

		.editor-body {
			padding-inline: 14px;
		}
	}
</style>
