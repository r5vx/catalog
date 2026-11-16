<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * Settings → Online, owner only: how much the meeting point (Cloudflare) is used each day,
	 * next to the free plan's daily limits, so it's seen before it runs out (owner, 2026-11-16).
	 * The server counts its own requests and database rows (cloud/src/worker.js, "how much it's
	 * used"); days are UTC, as Cloudflare's limits are. Today so far against each limit, then the
	 * last 30 days as bars, one count at a time.
	 *
	 * To change the look: the bar color is the accent (`--accent`), BAR_GAP is the space between
	 * bars, and the chart's height is CHART_HEIGHT.
	 */
	type Day = { day: string; requests: number; rowsRead: number; rowsWritten: number };
	type Limits = { requests: number; rowsRead: number; rowsWritten: number };
	type Measure = keyof Limits;

	const CHART_HEIGHT = 150;
	const BAR_GAP = 2;
	const MEASURES: { key: Measure; label: string }[] = [
		{ key: 'requests', label: 'Requests' },
		{ key: 'rowsRead', label: 'Rows read' },
		{ key: 'rowsWritten', label: 'Rows written' }
	];

	let days = $state<Day[]>([]);
	let limits = $state<Limits>({ requests: 100_000, rowsRead: 5_000_000, rowsWritten: 100_000 });
	let problem = $state('');
	let loading = $state(true);
	let measure = $state<Measure>('requests');
	let hovered = $state<number | null>(null);
	let showTable = $state(false);

	async function load() {
		loading = true;
		const answer = await fetch('/api/online/usage')
			.then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => null) }))
			.catch(() => null);
		loading = false;
		problem = answer?.ok ? '' : (answer?.data?.error ?? "The server's use couldn't be read");
		if (answer?.ok) {
			days = answer.data?.days ?? [];
			if (answer.data?.limits) limits = answer.data.limits;
		}
	}
	onMount(load);

	const todayKey = () => new Date().toISOString().slice(0, 10);
	const today = $derived(days.find((d) => d.day === todayKey()) ?? { day: todayKey(), requests: 0, rowsRead: 0, rowsWritten: 0 });
	const number = (n: number) => n.toLocaleString();
	const share = (n: number, of: number) => (of ? Math.min(100, (n / of) * 100) : 0);
	const percent = (n: number, of: number) => {
		const p = share(n, of);
		return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
	};
	const dayName = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

	/** The last 30 days, oldest first; a day the server wasn't asked anything is 0. */
	const shown = $derived.by(() => {
		const byDay = new Map(days.map((d) => [d.day, d]));
		const out: Day[] = [];
		for (let i = 29; i >= 0; i--) {
			const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
			out.push(byDay.get(day) ?? { day, requests: 0, rowsRead: 0, rowsWritten: 0 });
		}
		return out;
	});
	const counted = $derived(days.length > 0);
	const highest = $derived(Math.max(1, ...shown.map((d) => d[measure])));
	/** A round top for the scale, so its one line reads as a plain number. */
	const top = $derived.by(() => {
		const step = 10 ** Math.floor(Math.log10(highest));
		return Math.ceil(highest / step) * step;
	});
	const limitLabel = $derived(MEASURES.find((m) => m.key === measure)?.label ?? '');
</script>

<section class="server-use">
	<h2>Server use</h2>
	<p class="muted">What Catalog online asks of Cloudflare each day, against the free plan's daily limits. Days start at midnight UTC.</p>

	{#if problem}
		<p class="msg bad">{problem}</p>
	{:else if loading && !counted}
		<p class="muted">Loading…</p>
	{:else}
		<div class="meters">
			{#each MEASURES as m (m.key)}
				{@const used = today[m.key]}
				<div class="meter">
					<span class="meter-label">{m.label} today</span>
					<span class="meter-value">{number(used)}</span>
					<span class="track" role="img" aria-label="{percent(used, limits[m.key])} of {number(limits[m.key])}">
						<span class="fill" class:near={share(used, limits[m.key]) >= 80} style:width="{share(used, limits[m.key])}%"></span>
					</span>
					<span class="faint">{percent(used, limits[m.key])} of {number(limits[m.key])}</span>
				</div>
			{/each}
		</div>

		<div class="chart-head">
			<div class="measures" role="group" aria-label="Which count">
				{#each MEASURES as m (m.key)}
					<button type="button" class="measure" class:on={measure === m.key} aria-pressed={measure === m.key} onclick={() => (measure = m.key)}>{m.label}</button>
				{/each}
			</div>
			<span class="faint">Last 30 days · limit {number(limits[measure])} a day</span>
		</div>

		{#if !counted}
			<p class="muted">Nothing counted yet: the server starts counting once its new version is online.</p>
		{:else}
			<div class="chart" role="img" aria-label="{limitLabel} per day, last 30 days">
				<div class="scale" aria-hidden="true">
					<span>{number(top)}</span>
					<span>0</span>
				</div>
				<div class="plot" role="presentation" style:height="{CHART_HEIGHT}px" style:gap="{BAR_GAP}px" onpointerleave={() => (hovered = null)}>
					<span class="gridline" aria-hidden="true"></span>
					{#each shown as d, i (d.day)}
						<!-- The whole column is the hover target, not just the bar. -->
						<span class="column" onpointerenter={() => (hovered = i)} role="presentation">
							<span class="bar" class:today={d.day === todayKey()} style:height="{(d[measure] / top) * 100}%"></span>
						</span>
					{/each}
					{#if hovered !== null}
						{@const d = shown[hovered]}
						<!-- (Near either end it leans inward, so it isn't cut off.) -->
						<div
							class="tip"
							style:left="{((hovered + 0.5) / shown.length) * 100}%"
							style:transform={hovered < 4 ? 'translateX(-12px)' : hovered > shown.length - 5 ? 'translateX(calc(-100% + 12px))' : 'translateX(-50%)'}
						>
							<strong>{dayName(d.day)}{d.day === todayKey() ? ' (so far)' : ''}</strong>
							<span>{number(d[measure])} {limitLabel.toLowerCase()}</span>
							<span class="faint">{percent(d[measure], limits[measure])} of the limit</span>
						</div>
					{/if}
				</div>
				<div class="days" aria-hidden="true">
					<span>{dayName(shown[0].day)}</span>
					<span>Today</span>
				</div>
			</div>
		{/if}

		<div class="row">
			<button type="button" class="btn" onclick={load} disabled={loading}>Look again</button>
			{#if counted}<button type="button" class="link" onclick={() => (showTable = !showTable)}>{showTable ? 'Hide the numbers' : 'Show the numbers'}</button>{/if}
		</div>
		{#if showTable && counted}
			<table>
				<thead><tr><th>Day</th><th>Requests</th><th>Rows read</th><th>Rows written</th></tr></thead>
				<tbody>
					{#each [...days].reverse() as d (d.day)}
						<tr><td>{dayName(d.day)}</td><td>{number(d.requests)}</td><td>{number(d.rowsRead)}</td><td>{number(d.rowsWritten)}</td></tr>
					{/each}
				</tbody>
			</table>
		{/if}
	{/if}
</section>

<style>
	.server-use {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 28px;
	}

	h2 {
		font-size: 1.1rem;
		margin: 0;
	}

	p {
		margin: 0;
		max-width: 62ch;
	}

	.bad {
		color: var(--warn);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}

	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--accent);
		font: inherit;
		cursor: pointer;
		text-decoration: underline;
	}

	.meters {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 10px;
		margin: 2px 0 8px;
	}

	.meter {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px 14px;
		border-radius: var(--radius);
		background: var(--surface-2);
	}

	.meter-label {
		font-size: 0.85rem;
		color: var(--ink-soft);
	}

	.meter-value {
		font-size: 1.4rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.track {
		height: 6px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--ink) 12%, transparent);
		overflow: hidden;
	}

	.fill {
		display: block;
		height: 100%;
		min-width: 2px;
		border-radius: 999px;
		background: var(--accent);
	}

	/* 80% of a limit or more: the warning color, with the percentage beside it saying so too. */
	.fill.near {
		background: var(--warn);
	}

	.chart-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 8px;
	}

	.measures {
		display: inline-flex;
		gap: 4px;
		padding: 3px;
		border-radius: var(--radius);
		background: var(--surface-2);
	}

	.measure {
		padding: 5px 10px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-soft);
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}

	.measure.on {
		background: var(--surface);
		color: var(--ink);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.18);
	}

	.chart {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px 8px;
	}

	.scale {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		font-size: 0.75rem;
		color: var(--ink-soft);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.plot {
		position: relative;
		display: flex;
		align-items: flex-end;
		border-bottom: 1px solid color-mix(in srgb, var(--ink) 25%, transparent);
	}

	.gridline {
		position: absolute;
		inset: 0 0 auto;
		border-top: 1px dashed color-mix(in srgb, var(--ink) 15%, transparent);
		pointer-events: none;
	}

	.column {
		flex: 1;
		height: 100%;
		display: flex;
		align-items: flex-end;
		cursor: default;
	}

	.bar {
		display: block;
		width: 100%;
		min-height: 1px;
		border-radius: 4px 4px 0 0;
		background: color-mix(in srgb, var(--accent) 70%, transparent);
	}

	.column:hover .bar,
	.bar.today {
		background: var(--accent);
	}

	.tip {
		position: absolute;
		bottom: calc(100% + 6px);
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 7px 10px;
		border-radius: var(--radius-sm);
		background: var(--surface);
		box-shadow: 0 4px 14px rgb(0 0 0 / 0.3);
		font-size: 0.82rem;
		white-space: nowrap;
		pointer-events: none;
		z-index: 2;
	}

	.days {
		grid-column: 2;
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		color: var(--ink-soft);
	}

	table {
		width: 100%;
		margin-top: 10px;
		border-collapse: collapse;
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}

	th,
	td {
		padding: 5px 8px;
		text-align: right;
		border-bottom: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
	}

	th:first-child,
	td:first-child {
		text-align: left;
	}
</style>
