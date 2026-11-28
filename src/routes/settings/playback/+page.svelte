<script lang="ts">
	import WatchProgress from './WatchProgress.svelte';
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
		/** Still loading 8 s after a jump (Skip Intro, back 10 s): counted from the jump. */
		afterJump?: boolean;
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

	let autoSolve = $state(true);
	let autoSolveSaved = $state(false);
	$effect(() => { autoSolve = data.autoSolve; });
	async function saveAutoSolve(on: boolean) {
		autoSolve = on;
		autoSolveSaved = false;
		const answer = await fetch('/api/auto-solve', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ on })
		}).catch(() => null);
		autoSolveSaved = Boolean(answer?.ok);
	}

	// Picture: how this computer's Catalog window draws video (after it's opened again).
	let noOverlay = $state(false);
	let overlaySaved = $state(false);
	$effect(() => {
		noOverlay = data.noOverlay;
	});
	async function saveNoOverlay(on: boolean) {
		noOverlay = on;
		overlaySaved = false;
		const answer = await fetch('/api/video-drawing', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ noOverlay: on })
		}).catch(() => null);
		overlaySaved = Boolean(answer?.ok);
	}
	/** The newest few, one line each (owner, 2026-11-15: the long list pushed the rest of the page down). */
	const FIRST_SHOWN = 5;
	let showAllStops = $state(false);
	const shownStops = $derived(showAllStops ? stops : stops.slice(0, FIRST_SHOWN));

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

	const lasted = (stop: Stop) => (stop.afterJump && stop.stoppedSeconds != null ? 'After a jump: ' : '') + (lastedFor(stop) ?? '');
	const lastedFor = (stop: Stop) =>
		stop.stoppedSeconds == null ? null : stop.ended === 'still' ? 'still stopped after 30 s' : stop.ended === 'left' ? `${stop.stoppedSeconds} s, then left or changed` : `${stop.stoppedSeconds} s`;

	/*
	 * This profile's audio language (src/lib/server/audioLanguage.ts): films and shows come dubbed
	 * in it where Movy has a copy, the original otherwise.
	 */
	const LANGUAGES = [
		{ code: '', name: 'Original' },
		{ code: 'es', name: 'Spanish' },
		{ code: 'fr', name: 'French' },
		{ code: 'de', name: 'German' },
		{ code: 'hi', name: 'Hindi' }
	];
	let audioLanguage = $state('');
	let audioSaved = $state(false);
	$effect(() => {
		fetch('/api/profile-audio')
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => {
				if (d) audioLanguage = d.language ?? '';
			})
			.catch(() => {});
	});
	async function saveAudioLanguage() {
		audioSaved = false;
		await fetch('/api/profile-audio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: audioLanguage }) }).catch(() => {});
		audioSaved = true;
	}
</script>

<svelte:head><title>Playback · Catalog</title></svelte:head>

<div class="sections">
	<section>
		<div class="head"><h2>Audio language</h2></div>
		<p class="muted">
			For this profile. Plays dubbed where there's a copy in this language (often lower quality).
		</p>
		<div class="inline-form">
			<select bind:value={audioLanguage} onchange={saveAudioLanguage} aria-label="Audio language">
				{#each LANGUAGES as language (language.code)}
					<option value={language.code}>{language.name}</option>
				{/each}
			</select>
			{#if audioSaved}<span class="muted">Saved.</span>{/if}
		</div>
	</section>

	<section>
		<div class="head"><h2>Cloudflare checks</h2></div>
		<label class="toggle">
			<input type="checkbox" checked={autoSolve} onchange={(e) => saveAutoSolve(e.currentTarget.checked)} />
			Solve AllAnime's check automatically
		</label>
		<p class="muted">
			When on, the check is solved in the background and the source starts playing by itself.
			When off, a small window opens for you to tick the box.
		</p>
		{#if autoSolveSaved}<p class="muted">Saved.</p>{/if}
	</section>

	<!-- This computer's Catalog window only, read when it starts (src/lib/server/videoDrawing.ts). -->
	<section>
		<div class="head"><h2>Picture</h2></div>
		<label class="toggle">
			<input type="checkbox" checked={noOverlay} onchange={(e) => saveNoOverlay(e.currentTarget.checked)} />
			Draw video without the graphics card's overlay
		</label>
		<p class="muted">
			Try this if the picture jumps or flickers for a moment on this computer. Takes effect the next time Catalog is opened.
		</p>
		{#if overlaySaved}<p class="muted">Saved. Close Catalog and open it again.</p>{/if}
	</section>

	<section class="wide-full">
		<div class="head"><h2>Sources</h2></div>
		<p class="muted">Where Catalog looks for movies and shows to play. Each title checks every source it can use.</p>
		<div class="source-groups">
			<div class="source-group">
				<h3>Movies and TV</h3>
				<ul class="source-list">
					<li><strong>Showbox</strong> — films and series, with Febbox accounts</li>
					<li><strong>7Movies</strong> — films and series via Vidrift</li>
					<li><strong>Movy</strong> — films and series</li>
					<li><strong>Vidfast</strong> — films and series</li>
					<li><strong>Xumo Play</strong> — free films and shows (no account)</li>
					<li><strong>Tubi</strong> — free films (no account, desktop only)</li>
					<li><strong>Plex</strong> — free films and shows (no account)</li>
					<li><strong>Pluto TV</strong> — free films, shows and live TV (no account)</li>
					<li><strong>YouTube</strong> — matched uploads from publishers</li>
				</ul>
			</div>
			<div class="source-group">
				<h3>Anime</h3>
				<ul class="source-list">
					<li><strong>Aniwave</strong> — sub and dub</li>
					<li><strong>HiAnime</strong> — sub and dub</li>
					<li><strong>KickAssAnime</strong> — sub and dub, direct HLS</li>
				</ul>
			</div>
			<div class="source-group">
				<h3>Torrents (with debrid)</h3>
				<ul class="source-list">
					<li><strong>Torrentio</strong> — via Stremio add-ons</li>
					<li><strong>Nyaa</strong> — anime torrents</li>
				</ul>
			</div>
			<div class="source-group">
				<h3>Live</h3>
				<ul class="source-list">
					<li><strong>DaddyLive</strong> — sports and live channels</li>
					<li><strong>Pluto TV</strong> — free live channels</li>
				</ul>
			</div>
		</div>
	</section>

	<!-- Long: across both columns with the wide layout (settings/+layout.svelte). -->
	<section class="wide-full">
		<div class="head"><h2>Times a video stopped to load</h2></div>
		<p class="muted">
			From this computer and the TVs that watch through it.
		</p>

		{#if stops.length}
			<ul class="stops">
				{#each shownStops as stop (stop.at)}
					<li>
						<details>
						<summary>
							<span class="top">
								<b>{stop.title || 'Video'}</b>
								<span class="faint">{when(stop.at)}{stop.tv ? ' · TV' : ''}</span>
							</span>
							<span class="why">{guess(stop)}</span>
						</summary>
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
						</details>
					</li>
				{/each}
			</ul>
			{#if stops.length > FIRST_SHOWN}
				<button type="button" class="btn show-all" onclick={() => (showAllStops = !showAllStops)}>
					{showAllStops ? 'Show fewer' : `Show all ${stops.length}`}
				</button>
			{/if}
		{:else}
			<p class="faint">None yet.</p>
		{/if}
	</section>
</div>

<!-- Saved positions and history (was its own page, Watch Progress, until 2026-11-14). -->
<div class="part"><WatchProgress /></div>

<style>
	/* The Picture switch: only the box and its words take a click (as in Settings → Online). */
	.toggle {
		display: inline-flex;
		align-self: flex-start;
		max-width: 100%;
		align-items: center;
		gap: 8px;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.toggle input {
		width: auto;
	}

	.sections {
		display: flex;
		flex-direction: column;
		gap: 38px;
	}

	/* Watch progress, under the playback sections: the same space as between any two. */
	.part {
		margin-top: 38px;
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

	.source-groups {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 20px;
	}

	.source-group h3 {
		font-size: 0.9rem;
		font-weight: 600;
		margin: 0 0 8px;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.source-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 0.88rem;
	}

	.source-list li {
		line-height: 1.4;
	}

	.source-list strong {
		color: var(--ink);
	}

	.source-list li {
		color: var(--ink-muted);
	}

	.stops {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.stops li {
		border-bottom: 1px solid var(--rule);
	}

	/* One line a stop: title, when, and the likely reason; a press opens the details. */
	summary {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px 0;
		cursor: pointer;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	.top {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	.why {
		font-size: 0.88rem;
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	details[open] .why {
		white-space: normal;
	}

	details[open] dl {
		padding-bottom: 10px;
	}

	.show-all {
		align-self: flex-start;
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
