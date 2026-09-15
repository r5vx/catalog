<script lang="ts">
	/**
	 * Every score for one title, side by side.
	 *
	 * Each source uses its own scale — out of 10, a percentage, out of 100 —
	 * and they're shown as each one publishes them rather than converted to a
	 * common number, because "87%" and "8.7" don't mean the same thing.
	 */
	let {
		mine = null,
		site = null,
		siteVotes = null,
		siteName = 'TMDB',
		imdb = null,
		imdbVotes = null,
		rt = null,
		metascore = null,
		contentRating = null,
		loading = false
	}: {
		mine?: number | null;
		/** The provider the title came from — TMDB for film and TV, AniList for anime. */
		site?: number | null;
		siteVotes?: number | null;
		siteName?: string;
		imdb?: number | null;
		imdbVotes?: number | null;
		rt?: number | null;
		metascore?: number | null;
		contentRating?: string | null;
		loading?: boolean;
	} = $props();

	/** 12,345 rather than 12345 — vote counts are unreadable otherwise. */
	const grouped = (n: number) => n.toLocaleString();

	/** Rotten Tomatoes calls 60% and up "fresh". Metacritic's cut is 61. */
	const tone = (value: number, good: number, bad: number) =>
		value >= good ? 'good' : value >= bad ? 'warn' : 'bad';

	const anything = $derived(
		mine != null || site != null || imdb != null || rt != null || metascore != null
	);
</script>

{#if anything || loading}
	<div class="scores">
		{#if mine != null}
			<div class="score mine">
				<span class="value tabular">{mine}<span class="of">/10</span></span>
				<span class="from">You</span>
			</div>
		{/if}

		{#if site != null}
			<div class="score">
				<span class="value tabular">{site.toFixed(1)}<span class="of">/10</span></span>
				<span class="from"
					>{siteName}{#if siteVotes}<span class="votes">&nbsp;· {grouped(siteVotes)}</span>{/if}</span
				>
			</div>
		{/if}

		{#if imdb != null}
			<div class="score">
				<span class="value tabular">{imdb.toFixed(1)}<span class="of">/10</span></span>
				<span class="from">IMDb{#if imdbVotes}<span class="votes">&nbsp;· {grouped(imdbVotes)}</span>{/if}</span>
			</div>
		{/if}

		{#if rt != null}
			<div class="score {tone(rt, 60, 40)}">
				<span class="value tabular">{rt}<span class="of">%</span></span>
				<span class="from">Rotten Tomatoes</span>
			</div>
		{/if}

		{#if metascore != null}
			<div class="score {tone(metascore, 61, 40)}">
				<span class="value tabular">{metascore}<span class="of">/100</span></span>
				<span class="from">Metacritic</span>
			</div>
		{/if}

		{#if contentRating}
			<div class="score">
				<span class="value">{contentRating}</span>
				<span class="from">Rated</span>
			</div>
		{/if}

		{#if loading}
			<div class="score pending">
				<span class="value">···</span>
				<span class="from">Looking up</span>
			</div>
		{/if}
	</div>
{/if}

<style>
	.scores {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.score {
		display: flex;
		flex-direction: column;
		gap: 1px;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		padding: 7px 12px;
		min-width: 72px;
	}

	.value {
		font-family: var(--display);
		font-size: 1.15rem;
		font-weight: 600;
		line-height: 1.1;
	}

	.of {
		font-size: 0.68em;
		font-weight: 500;
		color: var(--ink-faint);
		margin-left: 1px;
	}

	.from {
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-faint);
		white-space: nowrap;
	}

	.votes {
		font-weight: 500;
		letter-spacing: 0;
		text-transform: none;
	}

	/* Your own score is the one that's actually yours, so it stands out. */
	.mine {
		background: var(--accent-bg);
		border-color: color-mix(in srgb, var(--accent) 38%, transparent);
	}

	.mine .value {
		color: var(--accent);
	}

	.good {
		border-color: color-mix(in srgb, var(--good) 40%, transparent);
	}
	.good .value {
		color: var(--good);
	}

	.warn {
		border-color: color-mix(in srgb, var(--warn) 40%, transparent);
	}
	.warn .value {
		color: var(--warn);
	}

	.bad .value {
		color: var(--ink-soft);
	}

	.pending .value {
		color: var(--ink-faint);
		letter-spacing: 0.1em;
	}
</style>
