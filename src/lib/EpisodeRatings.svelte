<script lang="ts">
	/**
	 * Every episode's rating on a show's page, as a chart: a column per season, a row per
	 * episode, each square colored from great (9+) to bad (under 6), with each season's average
	 * along the bottom. IMDb's ratings where IMDb has the show, else TMDB's
	 * (src/lib/server/episodeRatings.ts). Closed until opened, and only then asked for.
	 * The colors are tokens at the top of src/app.css (--rating-great … --rating-bad).
	 */
	import Fold from '$lib/Fold.svelte';

	let { source, sourceId, title }: { source: string; sourceId: string; title: string } = $props();

	type Episode = { episode: number; title: string; rating: number | null };
	type Ratings = { from: 'IMDb' | 'TMDB'; seasons: { number: number; episodes: Episode[] }[] };

	let ratings = $state<Ratings | null>(null);
	let phase = $state<'idle' | 'loading' | 'done'>('idle');

	async function load() {
		if (phase !== 'idle') return;
		phase = 'loading';
		try {
			const params = new URLSearchParams({ source, id: sourceId, title });
			const resp = await fetch(`/api/episode-ratings?${params}`);
			if (resp.ok) ratings = await resp.json();
		} catch {}
		phase = 'done';
	}

	const rows = $derived(Math.max(0, ...(ratings?.seasons ?? []).map((s) => Math.max(0, ...s.episodes.map((e) => e.episode)))));
	const rated = $derived(ratings?.seasons.some((s) => s.episodes.some((e) => e.rating !== null)) ?? false);

	function level(rating: number | null): string {
		if (rating === null) return 'none';
		if (rating >= 9) return 'great';
		if (rating >= 8) return 'good';
		if (rating >= 7) return 'ok';
		if (rating >= 6) return 'meh';
		return 'bad';
	}

	function average(episodes: Episode[]): number | null {
		const known = episodes.map((e) => e.rating).filter((r): r is number => r !== null);
		return known.length ? Math.round((known.reduce((a, b) => a + b, 0) / known.length) * 10) / 10 : null;
	}

	const sub = $derived(
		phase === 'done' && ratings && rated
			? `${ratings.from} · ${ratings.seasons.length} ${ratings.seasons.length === 1 ? 'season' : 'seasons'}`
			: 'Every episode, season by season'
	);
</script>

<Fold title="Episode ratings" {sub} onopen={load}>
	{#if phase === 'loading'}
		<p class="faint note">Loading ratings…</p>
	{:else if phase === 'done' && (!ratings || !rated)}
		<p class="faint note">No ratings for its episodes yet.</p>
	{:else if ratings}
		<div class="scroll">
			<table class="chart">
				<thead>
					<tr>
						<th></th>
						{#each ratings.seasons as season (season.number)}
							<th scope="col">S{season.number}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each { length: rows } as _, i (i)}
						<tr>
							<th scope="row">E{i + 1}</th>
							{#each ratings.seasons as season (season.number)}
								{@const ep = season.episodes.find((e) => e.episode === i + 1)}
								{#if ep}
									<td class="cell {level(ep.rating)}" title="S{season.number}E{ep.episode} · {ep.title}{ep.rating !== null ? ` · ${ep.rating.toFixed(1)}` : ' · not rated yet'}">
										{ep.rating !== null ? ep.rating.toFixed(1) : '–'}
									</td>
								{:else}
									<td></td>
								{/if}
							{/each}
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr>
						<th scope="row">Avg</th>
						{#each ratings.seasons as season (season.number)}
							{@const avg = average(season.episodes)}
							<td class="cell avg {level(avg)}" title="Season {season.number}{avg !== null ? ` · average ${avg.toFixed(1)}` : ''}">
								{avg !== null ? avg.toFixed(1) : '–'}
							</td>
						{/each}
					</tr>
				</tfoot>
			</table>
		</div>
		<p class="faint note">{ratings.from === 'IMDb' ? "IMDb's ratings" : "TMDB's ratings (IMDb has none for it)"}</p>
	{/if}
</Fold>

<style>
	.note {
		margin: 0;
		font-size: 0.85rem;
	}

	/* A long-running show scrolls sideways inside the chart, never the page. */
	.scroll {
		overflow-x: auto;
		max-width: 100%;
	}

	.chart {
		border-collapse: separate;
		border-spacing: 3px;
		font-size: 0.78rem;
		font-variant-numeric: tabular-nums;
	}

	th {
		font-weight: 600;
		color: var(--ink-faint);
		padding: 0 4px;
		white-space: nowrap;
	}

	thead th {
		text-align: center;
	}

	tbody th,
	tfoot th {
		text-align: right;
	}

	.cell {
		min-width: 38px;
		height: 24px;
		padding: 0 4px;
		text-align: center;
		border-radius: var(--radius-sm);
		color: var(--rating-ink);
		font-weight: 600;
		cursor: default;
	}

	.great { background: var(--rating-great); }
	.good { background: var(--rating-good); }
	.ok { background: var(--rating-ok); }
	.meh { background: var(--rating-meh); }
	.bad { background: var(--rating-bad); }

	.none {
		background: var(--surface-2);
		color: var(--ink-faint);
		font-weight: 400;
	}

	/* The averages, set apart from the episodes above them. */
	tfoot .cell {
		outline: 2px solid var(--surface);
		box-shadow: 0 -4px 0 -2px var(--rule-firm);
	}
</style>
