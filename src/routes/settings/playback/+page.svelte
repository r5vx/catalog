<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Stop = {
		at: string;
		title?: string;
		source?: string;
		height?: number;
		quality?: string;
		tv?: boolean;
		aheadSeconds?: number;
		needsMbps?: number | null;
		piecesMbps?: number[];
		fromMemory?: number;
		servers?: string[];
		relayed?: boolean;
		previewsDownloading?: number;
		hearingSound?: boolean;
		computer?: { host: string; pieces: number; mbpsEach: number; slowestSeconds: number }[];
	};
	const stops = $derived(data.stops as Stop[]);

	const when = (iso: string) =>
		new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	const typical = (list: number[] = []) => (list.length ? [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] : null);

	/** A best guess at why, from the numbers (the numbers themselves are shown too). */
	function guess(stop: Stop): string {
		const each = typical(stop.piecesMbps);
		const need = stop.needsMbps ?? null;
		const site = stop.computer?.find((c) => c.pieces > 0);
		if (stop.relayed && site && need && site.mbpsEach < need) return `The site was slow sending to this computer (${site.mbpsEach} Mbps a piece).`;
		if (stop.relayed && site && each !== null && need && each < need) return 'This computer had it, but it reached the TV slowly (Wi-Fi between them).';
		if (each !== null && need && each < need) return `The video server was slow (${each} Mbps a piece, ${need} needed).`;
		if (stop.previewsDownloading || stop.hearingSound) return 'Catalog was downloading other things at the same time.';
		return 'No clear cause in the numbers.';
	}
</script>

<svelte:head><title>Playback · Catalog</title></svelte:head>

<div class="sections">
	<section>
		<div class="head"><h2>Times a video stopped to load</h2></div>
		<p class="muted">
			Kept each time, here and on TVs watching through this computer, with how fast it was arriving and from where.
		</p>

		{#if stops.length}
			<ul class="stops">
				{#each stops as stop (stop.at)}
					<li>
						<div class="top">
							<b>{stop.title || 'Video'}</b>
							<span class="faint">{when(stop.at)}{stop.tv ? ' · TV' : ''}</span>
						</div>
						<p class="why">{guess(stop)}</p>
						<dl>
							<dt>Source</dt><dd>{stop.source ?? '—'} · {stop.height ? `${stop.height}p` : (stop.quality ?? '')}{stop.relayed ? ' · through this computer' : ''}</dd>
							<dt>Loaded ahead</dt><dd>{stop.aheadSeconds ?? '—'} s</dd>
							<dt>Each piece</dt><dd>{stop.piecesMbps?.length ? `${stop.piecesMbps.join(' · ')} Mbps` : '—'}{stop.needsMbps ? ` (needs ${stop.needsMbps})` : ''}</dd>
							{#if stop.relayed}
								<dt>This computer</dt>
								<dd>{stop.computer?.length ? stop.computer.map((c) => `${c.host}: ${c.mbpsEach} Mbps a piece, slowest ${c.slowestSeconds} s`).join('; ') : 'nothing fetched in the last 90 s'}</dd>
							{/if}
							<dt>Server</dt><dd>{stop.servers?.join(', ') || '—'}</dd>
							<dt>Also downloading</dt><dd>{[stop.previewsDownloading ? 'preview pictures' : '', stop.hearingSound ? 'sound for auto-timing' : ''].filter(Boolean).join(', ') || 'nothing'}</dd>
						</dl>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="faint">None yet.</p>
		{/if}
	</section>
</div>

<style>
	.sections {
		display: flex;
		flex-direction: column;
		gap: 38px;
	}

	section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.head {
		border-bottom: 1px solid var(--rule);
		padding-bottom: 8px;
	}

	h2 {
		font-size: 1.1rem;
	}

	.muted {
		font-size: 0.93rem;
		margin: 0;
	}

	.stops {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.stops li {
		padding: 12px 0;
		border-bottom: 1px solid var(--rule);
	}

	.top {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	.why {
		margin: 4px 0 8px;
	}

	dl {
		display: grid;
		grid-template-columns: 130px 1fr;
		gap: 2px 12px;
		margin: 0;
		font-size: 0.85rem;
	}

	dt {
		color: var(--ink-faint);
	}

	dd {
		margin: 0;
		word-break: break-word;
	}
</style>
