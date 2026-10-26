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
		position?: number;
		aheadSeconds?: number;
		needsMbps?: number | null;
		piecesMbps?: number[];
		fromMemory?: number;
		servers?: string[];
		relayed?: boolean;
		previewsDownloading?: number;
		hearingSound?: boolean;
		pictureAhead?: number | null;
		soundAhead?: number | null;
		soundPiecesSeconds?: number[];
		computer?: { host: string; pieces: number; mbpsEach: number; slowestSeconds: number }[];
		// Kept since 2026-10-25 (older stops don't have them):
		what?: string;
		stoppedSeconds?: number;
		ended?: 'played' | 'still' | 'left';
		pieceCameAfter?: number | null;
		hevc?: boolean;
		framesDrawn?: number | null;
		framesDropped?: number | null;
		gap?: number | null;
		hidden?: boolean;
		waitingFor?: { kind: string; n: number; seconds: number } | null;
		lastPieceSecondsAgo?: number | null;
		before?: { secondsBefore: number; what: string }[];
	};
	const stops = $derived(data.stops as Stop[]);

	const when = (iso: string) =>
		new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	const typical = (list: number[] = []) => (list.length ? [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] : null);
	const droppedShare = (stop: Stop) =>
		stop.framesDrawn && stop.framesDropped != null ? stop.framesDropped / (stop.framesDrawn + stop.framesDropped) : 0;
	/** Something from the moments before, matching `pattern`. */
	const justBefore = (stop: Stop, pattern: RegExp) => stop.before?.findLast((e) => pattern.test(e.what));

	/** A best guess at why, from the numbers (the numbers themselves are shown too). */
	function guess(stop: Stop): string {
		if (stop.what) return `${stop.what}.`;
		const each = typical(stop.piecesMbps);
		const need = stop.needsMbps ?? null;
		const site = stop.computer?.find((c) => c.pieces > 0);
		const ahead = stop.aheadSeconds ?? 0;

		// Plenty loaded: the connection wasn't it.
		if (ahead >= 3) {
			if (stop.gap != null) return `A hole of ${stop.gap} s in the video where it stopped (missing from this copy, not still loading): the player stepped over it.`;
			if (droppedShare(stop) > 0.1)
				return `The computer couldn't draw the picture fast enough (${stop.framesDropped} of ${stop.framesDrawn! + stop.framesDropped!} frames dropped in 10 s)${stop.hevc ? '. HEVC is hard work for some computers; the plain 7Movies copy is easier' : ''}.`;
			if (stop.hidden) return `The window was hidden or minimized, with ${ahead} s loaded.`;
			const change = justBefore(stop, /^quality changed|^sound track changed|^decoder rebuilt|^fresh link/);
			if (change) return `Right after: ${change.what} (${change.secondsBefore} s before), with ${ahead} s loaded.`;
			const jump = justBefore(stop, /^jumped/);
			if (jump && jump.secondsBefore < 10) return `Just after a jump (${jump.what}), with ${ahead} s loaded.`;
			const warning = justBefore(stop, /^player: /);
			if (warning) return `Not the connection (${ahead} s was loaded); just before, ${warning.what.replace('player: ', '')}.`;
			return `Not the connection: ${ahead} s was loaded. The browser paused the picture on its own.`;
		}

		// Ran out: what wasn't arriving.
		const timeouts = stop.before?.filter((e) => /took too long|didn't download/.test(e.what)).length ?? 0;
		if (stop.lastPieceSecondsAgo != null && stop.lastPieceSecondsAgo >= 8 && (stop.waitingFor || timeouts) && !site)
			return `Nothing arrived for ${stop.lastPieceSecondsAgo} s before it stopped: the video server stopped answering${timeouts ? ` (${timeouts} piece${timeouts > 1 ? 's' : ''} timed out)` : ''}.`;
		if (stop.waitingFor && stop.waitingFor.seconds >= 4) {
			const came = stop.pieceCameAfter != null ? `; it came after ${stop.pieceCameAfter} s` : stop.ended === 'still' ? '; still not here 30 s later' : '';
			return `A ${stop.waitingFor.kind} piece hung: asked for ${stop.waitingFor.seconds} s before${came}${each !== null && need && each >= need ? ', while other pieces came fast' : ''}.`;
		}
		// (Some playlists don't say how fast the video needs to come: then a piece taking 8 s or more.)
		const siteSlow = stop.relayed && site && (need ? site.mbpsEach < need : site.slowestSeconds >= 8);
		if (stop.pieceCameAfter != null && stop.pieceCameAfter >= 4)
			return `A ${stop.waitingFor?.kind ?? ''} piece took ${stop.pieceCameAfter} s to come${siteSlow ? `: the site was slow sending to this computer (${site!.mbpsEach} Mbps a piece, slowest ${site!.slowestSeconds} s)` : ''}.`;
		if (siteSlow) return `The site was slow sending to this computer (${site!.mbpsEach} Mbps a piece, slowest ${site!.slowestSeconds} s).`;
		if (stop.relayed && site && each !== null && need && each < need) return 'This computer had it, but it reached the TV slowly (Wi-Fi between them).';
		if (each !== null && need && each < need) return `The video server was slow (${each} Mbps a piece, ${need} needed).`;
		if (stop.pictureAhead != null && stop.soundAhead != null && stop.soundAhead < 2 && stop.pictureAhead >= 10)
			return `The sound track ran out while the picture was ${stop.pictureAhead} s ahead.`;
		if (stop.pictureAhead != null && stop.soundAhead != null && stop.pictureAhead < 2 && stop.soundAhead >= 10)
			return `The picture ran out while the sound was ${stop.soundAhead} s ahead.`;
		if (!stop.waitingFor && stop.lastPieceSecondsAgo != null && stop.lastPieceSecondsAgo > 10)
			return `The player had stopped asking for pieces (the last came ${stop.lastPieceSecondsAgo} s before).`;
		if (stop.previewsDownloading || stop.hearingSound) return 'Catalog was downloading other things at the same time.';
		// Older stops: mostly a switch (another source, episode or a fresh link) caught as the old video was cleared.
		if (!stop.height && !stop.position) return 'Probably a switch of source or episode, not a stop (kept before switches were left out).';
		return 'No clear cause in the numbers.';
	}

	const lasted = (stop: Stop) =>
		stop.stoppedSeconds == null ? null : stop.ended === 'still' ? 'still stopped after 30 s' : stop.ended === 'left' ? `${stop.stoppedSeconds} s, then left or changed` : `${stop.stoppedSeconds} s`;
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
							<dt>Loaded ahead</dt><dd>{stop.aheadSeconds ?? '—'} s{stop.pictureAhead != null && stop.soundAhead != null ? ` (picture ${stop.pictureAhead} s, sound ${stop.soundAhead} s)` : ''}</dd>
							<dt>Each piece</dt><dd>{stop.piecesMbps?.length ? `${stop.piecesMbps.join(' · ')} Mbps` : '—'}{stop.needsMbps ? ` (needs ${stop.needsMbps})` : ''}</dd>
							{#if stop.relayed}
								<dt>This computer</dt>
								<dd>{stop.computer?.length ? stop.computer.map((c) => `${c.host}: ${c.mbpsEach} Mbps a piece, slowest ${c.slowestSeconds} s`).join('; ') : 'nothing fetched in the last 90 s'}</dd>
							{/if}
							{#if stop.soundPiecesSeconds?.length}
								<dt>Sound pieces</dt><dd>{stop.soundPiecesSeconds.join(' · ')} s each</dd>
							{/if}
							{#if lasted(stop)}
								<dt>Stopped for</dt><dd>{lasted(stop)}</dd>
							{/if}
							{#if stop.waitingFor !== undefined}
								<dt>Waiting on</dt>
								<dd>{stop.waitingFor ? `${stop.waitingFor.kind} piece #${stop.waitingFor.n}, asked ${stop.waitingFor.seconds} s before${stop.pieceCameAfter != null ? `, came after ${stop.pieceCameAfter} s` : ''}` : 'nothing'}{stop.lastPieceSecondsAgo != null ? ` · last piece ${stop.lastPieceSecondsAgo} s before` : ''}</dd>
							{/if}
							{#if stop.framesDrawn != null}
								<dt>Picture</dt><dd>{stop.hevc ? 'HEVC' : 'H.264'} · {stop.framesDropped} of {stop.framesDrawn + (stop.framesDropped ?? 0)} frames dropped in 10 s{stop.gap != null ? ` · hole of ${stop.gap} s where it stopped` : ''}{stop.hidden ? ' · window hidden' : ''}</dd>
							{/if}
							{#if stop.before?.length}
								<dt>Just before</dt><dd>{stop.before.map((e) => `${e.what} (${e.secondsBefore} s)`).join(' · ')}</dd>
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
