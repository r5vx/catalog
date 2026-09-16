<script lang="ts">
	import ScoreStrip from '$lib/ScoreStrip.svelte';
	import Synopsis from '$lib/Synopsis.svelte';
	import TagChips from '$lib/TagChips.svelte';
	import CastRow from '$lib/CastRow.svelte';
	import WhereToWatch from '$lib/WhereToWatch.svelte';
	import { STATUSES } from '$lib/constants';
	import BackBar from '$lib/BackBar.svelte';
	import { money } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const details = $derived(data.details);

	const facts = $derived(
		[
			details.year ? String(details.year) : null,
			details.kind,
			details.seasons ? `${details.seasons} season${details.seasons === 1 ? '' : 's'}` : null,
			details.episodesTotal ? `${details.episodesTotal} episodes` : null,
			details.runtimeMinutes ? `${details.runtimeMinutes} min` : null,
			details.status,
			money(data.scores?.boxOffice)
		].filter(Boolean)
	);
</script>

<svelte:head><title>{details.title} · Catalog</title></svelte:head>

<BackBar href={data.back} />

<article>
	<header>
		<div class="poster">
			{#if details.posterUrl}
				<img src={details.posterUrl} alt="" />
			{:else}
				<span class="empty" aria-hidden="true">?</span>
			{/if}
		</div>

		<div class="meta">
			<p class="eyebrow faint">Not in your library</p>
			<h1>{details.title}</h1>
			{#if details.altTitle && details.altTitle !== details.title}
				<p class="alt muted">{details.altTitle}</p>
			{/if}

			<p class="facts faint tabular">{facts.join(' · ')}</p>

			<ScoreStrip
				site={details.externalRating}
				siteName={data.source === 'anilist' ? 'AniList' : 'TMDB'}
				{...data.source === 'tmdb' ? { siteVotes: details.externalVotes } : {}}
				imdb={data.scores?.imdbRating ?? null}
				imdbVotes={data.scores?.imdbVotes ?? null}
				rt={data.scores?.rtScore ?? null}
				metascore={data.scores?.metascore ?? null}
				contentRating={data.scores?.contentRating ?? null}
			/>

			<form method="POST" action="?/add" class="add">
				<select name="status" aria-label="Add it as">
					{#each STATUSES as option (option.value)}
						<option value={option.value} selected={option.value === 'planned'}>
							{option.label}
						</option>
					{/each}
				</select>
				<button type="submit" class="btn btn-primary">Add to library</button>
			</form>
		</div>
	</header>

	<Synopsis text={details.overview} tagline={details.tagline} />

	<WhereToWatch
		source={data.source}
		sourceId={data.sourceId}
		title={details.title}
		year={details.year}
	/>

	{#if data.scores?.awards}
		<section class="awards">
			<h2 class="label">Awards</h2>
			<p class="muted">{data.scores.awards}</p>
		</section>
	{/if}

	<TagChips tags={details.tags} />

	<!-- Everyone is clickable: ours by id, the rest by the provider's. -->
	<CastRow
		cast={data.cast.map((person) => ({ ...person, id: person.entryPersonId }))}
		back="/title/{data.source}/{data.sourceId}"
	/>

	{#if details.homepage}
		<p class="away">
			<a href={details.homepage} target="_blank" rel="noreferrer">Open on
				{data.source === 'anilist' ? 'AniList' : 'the official site'} &rarr;</a
			>
		</p>
	{/if}
</article>

<style>
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
		opacity: 0.35;
	}

	.meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.eyebrow {
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		margin: 0;
	}

	h1 {
		font-size: clamp(1.6rem, 4.5vw, 2.3rem);
		margin: -6px 0 0;
	}

	.alt,
	.facts {
		margin: -6px 0 0;
		font-size: 0.87rem;
	}

	.add {
		display: flex;
		gap: 8px;
		margin-top: 4px;
		max-width: 360px;
	}

	.add select {
		flex: 1;
		min-width: 0;
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

	.awards p {
		margin: 0;
		font-size: 0.92rem;
		max-width: 68ch;
	}

	.away {
		margin: 0;
		font-size: 0.87rem;
	}

	.away a {
		color: var(--accent);
	}

	.away a:hover {
		text-decoration: underline;
		text-underline-offset: 2px;
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
	}
</style>
