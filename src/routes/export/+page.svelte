<script lang="ts">
	import { statusLabel } from '$lib/constants';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const today = new Date().toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});

	/** "S2E7" — where you left off, when you said. */
	function episode(row: { lastSeason: number | null; lastEpisode: number | null }): string {
		if (row.lastSeason == null && row.lastEpisode == null) return '';
		return (row.lastSeason == null ? '' : `S${row.lastSeason}`) +
			(row.lastEpisode == null ? '' : `E${row.lastEpisode}`);
	}
</script>

<svelte:head><title>Catalog · Printable list</title></svelte:head>

<div class="bar noprint">
	<a href="/settings" class="back faint">&larr; Settings</a>
	<button type="button" class="btn btn-primary" onclick={() => window.print()}>
		Print / Save as PDF
	</button>
</div>

<article class="sheet">
	<header>
		<h1>Catalog</h1>
		<p class="sub">{data.scope} · {data.total} {data.total === 1 ? 'title' : 'titles'} · {today}</p>
	</header>

	{#each data.groups as group (group.name)}
		<section>
			<h2>{group.name} <span class="count">{group.rows.length}</span></h2>

			<table>
				<thead>
					<tr>
						<th class="num">#</th>
						<th>Title</th>
						<th class="num">Year</th>
						<th class="num">Mine</th>
						<th class="num">Public</th>
						<th>Status</th>
					</tr>
				</thead>
				<tbody>
					{#each group.rows as row, index (row.title + (row.year ?? '') + index)}
						<tr>
							<td class="num faint">{index + 1}</td>
							<td>
								{row.title}
								{#if row.favorite}<span class="star" title="Favourite">★</span>{/if}
								{#if episode(row)}<span class="mark">{episode(row)}</span>{/if}
							</td>
							<td class="num">{row.year ?? '—'}</td>
							<td class="num">{row.rating == null ? '—' : row.rating}</td>
							<td class="num">{row.externalRating == null ? '—' : row.externalRating.toFixed(1)}</td>
							<td>{statusLabel(row.status)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{:else}
		<p class="empty muted">Nothing matches that. Try a different category or status.</p>
	{/each}
</article>

<style>
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 6px;
	}

	.back:hover {
		color: var(--accent);
	}

	header {
		margin-bottom: 18px;
	}

	h1 {
		font-size: 1.9rem;
	}

	.sub {
		margin: 2px 0 0;
		color: var(--ink-soft);
		font-size: 0.9rem;
	}

	section {
		margin-top: 26px;
		/* Keep a short category whole on one page where it fits. */
		break-inside: auto;
	}

	h2 {
		font-size: 1.15rem;
		border-bottom: 1px solid var(--rule-firm);
		padding-bottom: 5px;
		margin-bottom: 8px;
		break-after: avoid;
	}

	.count {
		font-family: var(--body);
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--ink-faint);
		vertical-align: middle;
		margin-left: 4px;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.87rem;
	}

	th {
		text-align: left;
		font-size: 0.68rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
		font-weight: 600;
		padding: 4px 8px 4px 0;
	}

	td {
		padding: 4px 8px 4px 0;
		border-top: 1px solid var(--rule);
		vertical-align: baseline;
	}

	tr {
		break-inside: avoid;
	}

	/* Shrink-to-fit, so the title column keeps everything that's left over. */
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		width: 1%;
		padding-left: 14px;
	}

	/* The row number is a .num too, but it's the left edge of the table. */
	th:first-child,
	td:first-child {
		padding-left: 0;
	}

	.star {
		color: var(--accent);
	}

	.mark {
		font-family: var(--mono);
		font-size: 0.78em;
		color: var(--ink-faint);
		margin-left: 4px;
	}

	.empty {
		margin-top: 30px;
	}

	/**
	 * On paper nothing is themed: black on white, full width, and none of the
	 * app's chrome. The toolbar and the surrounding page padding go away so
	 * the sheet starts at the top of the page.
	 */
	@media print {
		.noprint {
			display: none !important;
		}

		:global(html),
		:global(body) {
			background: #fff !important;
			color: #000 !important;
		}

		:global(.app) {
			max-width: none !important;
			padding: 0 !important;
		}

		.sheet,
		.sheet * {
			color: #000 !important;
		}

		.sub,
		.count,
		td.faint,
		.mark {
			color: #555 !important;
		}

		h2 {
			border-bottom-color: #000 !important;
		}

		td {
			border-top-color: #ccc !important;
		}

		/* Repeat the column headings at the top of every page. */
		thead {
			display: table-header-group;
		}
	}

	@page {
		margin: 16mm;
	}
</style>
