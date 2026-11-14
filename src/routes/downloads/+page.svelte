<script lang="ts">
	/**
	 * Downloads (src/lib/server/downloads.ts): films, episodes and replays kept on the computer,
	 * started from Download in the player. Each plays here with no internet, or can be saved onto
	 * this device (a phone: an iPhone keeps it in the Files app) with its subtitles beside it.
	 * In the phone app (the secure address, Settings → Phones) each can be kept on the phone
	 * instead, to play with no connection (phoneKeep.svelte.ts); Play then uses that copy.
	 * Asks every two seconds while one is downloading.
	 */
	import { onDestroy, onMount } from 'svelte';
	import BackBar from '$lib/BackBar.svelte';
	import { confirmAction } from '$lib/confirm.svelte';
	import { downloadName } from '$lib/downloadName';
	import { canKeep, kept, keepOnPhone, refreshKept, removeFromPhone, stopKeeping } from '$lib/phoneKeep.svelte';
	import { inPhoneApp } from '$lib/phoneApp';

	type Download = {
		id: number;
		kind: 'film' | 'episode' | 'replay';
		title: string;
		year: string;
		season: number;
		episode: number;
		episodeName: string | null;
		poster: string | null;
		source: string;
		height: number;
		hasSubtitles: boolean;
		state: 'waiting' | 'downloading' | 'finishing' | 'done' | 'failed';
		donePieces: number;
		totalPieces: number;
		bytes: number;
		estimate: number;
		error: string | null;
		place: number;
		duration: number;
		speed: number;
	};

	let downloads = $state<Download[] | null>(null);
	let free = $state<number | null>(null);
	let failed = $state(false);

	async function load() {
		try {
			const answer = await fetch('/api/downloads').then((r) => (r.ok ? r.json() : Promise.reject()));
			downloads = answer.downloads;
			free = answer.free;
			failed = false;
		} catch {
			failed = true;
		}
		loadAhead();
	}

	/*
	 * On this computer for now: 7Movies' and Movy's episodes the computer downloaded ahead so they
	 * play without waiting (src/lib/server/episodeDownloads.ts). They go by themselves; Keep makes
	 * one a download like the rest.
	 */
	type Ahead = {
		share: string;
		source: string;
		type: 'tv' | 'movie';
		season: number;
		episode: number;
		title: string;
		year: string;
		poster: string | null;
		here: number;
		total: number;
		bytes: number;
		until: number;
		busy: boolean;
	};
	let ahead = $state<Ahead[]>([]);
	/** Ones Keep was pressed on (until they show in the list above). */
	let keeping = $state<string[]>([]);

	async function loadAhead() {
		const answer = await fetch('/api/downloads/ahead')
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		if (answer) ahead = answer.ahead;
	}

	const aheadName = (a: Ahead) => (a.type === 'tv' ? `${a.title || 'A show'} S${a.season}E${a.episode}` : a.title || 'A film');
	const aheadAll = (a: Ahead) => a.total > 0 && a.here >= a.total;
	const aheadHref = (a: Ahead) => {
		const params = new URLSearchParams({ title: a.title, type: a.type, year: a.year, auto: '1' });
		if (a.type === 'tv') {
			params.set('resume_s', String(a.season));
			params.set('resume_e', String(a.episode));
		}
		return `/watch?${params}`;
	};
	/** "until tonight", "for 6 more days". */
	function goesIn(a: Ahead): string {
		const hours = Math.max(0, (a.until - Date.now()) / 3_600_000);
		if (hours < 1) return 'goes within the hour';
		if (hours < 36) return `goes in about ${Math.round(hours)} hours`;
		return `goes in ${Math.round(hours / 24)} days`;
	}
	function aheadStatus(a: Ahead): string {
		const part = aheadAll(a) ? 'All of it' : a.total ? `${Math.floor((a.here / a.total) * 100)}% of it` : 'Part of it';
		return [part, size(a.bytes), a.source, a.busy ? 'in use' : goesIn(a)].join(' · ');
	}

	async function keepAhead(a: Ahead) {
		keeping = [...keeping, a.share];
		await fetch('/api/downloads/ahead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ share: a.share }) }).catch(() => null);
		await load();
	}

	async function removeAhead(a: Ahead) {
		const yes = await confirmAction({ title: `Remove "${aheadName(a)}"?`, message: "It's fetched again if it's played.", confirmLabel: 'Remove' });
		if (!yes) return;
		await fetch(`/api/downloads/ahead?share=${encodeURIComponent(a.share)}`, { method: 'DELETE' }).catch(() => null);
		await loadAhead();
	}

	/** In the phone app: downloads can be kept on the phone. */
	let phoneApp = $state(false);
	// Inside the iPhone app (ios/): there's no Home Screen step, the app itself is the app.
	let inApp = $state(false);
	/**
	 * A phone on Catalog's plain address (http://100.x…): it can't keep anything or open with no
	 * connection (browsers only allow that on a secure address), so in airplane mode Catalog just
	 * stopped (owner, 2026-11-06). It's told where the secure address is.
	 */
	let plainPhone = $state(false);
	let secureAddress = $state<string | null>(null);
	async function lookForSecureAddress() {
		const answer = await fetch('/api/phone-address')
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		secureAddress = answer?.on && answer.address ? answer.address : null;
	}

	function keep(d: Download) {
		keepOnPhone({
			id: d.id,
			kind: d.kind,
			title: d.title,
			year: d.year,
			season: d.season,
			episode: d.episode,
			episodeName: d.episodeName,
			poster: d.poster,
			bytes: d.bytes,
			duration: d.duration,
			place: d.place,
			hasSubtitles: d.hasSubtitles,
			name: downloadName(d)
		});
	}

	async function unkeep(d: Download) {
		const yes = await confirmAction({
			title: `Remove "${downloadName(d)}" from this phone?`,
			message: 'It stays on the computer, to keep again later.',
			confirmLabel: 'Remove'
		});
		if (yes) removeFromPhone(d.id);
	}

	let timer: ReturnType<typeof setInterval> | undefined;
	onMount(() => {
		phoneApp = canKeep() && location.protocol === 'https:';
		inApp = inPhoneApp();
		if (phoneApp) refreshKept();
		plainPhone =
			location.protocol !== 'https:' &&
			!/Electron\//.test(navigator.userAgent) &&
			!/^(localhost|127\.|\[::1\])/.test(location.hostname);
		if (plainPhone) lookForSecureAddress();
		load();
		timer = setInterval(() => {
			if (downloads?.some((d) => d.state !== 'done' && d.state !== 'failed')) load();
		}, 2000);
	});
	onDestroy(() => clearInterval(timer));

	const size = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`);
	const minutes = (seconds: number) => {
		const m = Math.max(1, Math.round(seconds / 60));
		return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
	};

	/** What's under its name: quality, size and source, or how far it's got. */
	function status(d: Download): string {
		const quality = d.height ? `${d.height}p` : '';
		if (d.state === 'done') {
			const left = d.place > 5 && d.duration > 0 && d.place / d.duration < 0.95 ? `${minutes(d.duration - d.place)} left` : '';
			const where = kept.ids.includes(d.id) ? 'On this phone' : d.id in kept.saving ? `Saving to this phone · ${Math.floor(((kept.saving[d.id] ?? 0) / Math.max(1, d.bytes)) * 100)}%` : '';
			return [where, left, quality, size(d.bytes), d.source].filter(Boolean).join(' · ');
		}
		if (d.state === 'waiting') return d.donePieces ? `Waiting · ${pct(d)}%` : 'Waiting';
		if (d.state === 'finishing') return 'Making the file';
		if (d.state === 'failed') return d.error ?? "Couldn't download";
		const speed = d.speed ? ` · ${(d.speed / 1024 ** 2).toFixed(1)} MB/s` : '';
		return `${pct(d)}% · ${size(d.bytes)}${d.estimate ? ` of about ${size(d.estimate)}` : ''}${speed}`;
	}
	const pct = (d: Download) => (d.totalPieces ? Math.floor((d.donePieces / d.totalPieces) * 100) : 0);

	async function remove(d: Download) {
		if (kept.ids.includes(d.id)) await removeFromPhone(d.id);
		const yes = await confirmAction({
			title: `Delete "${downloadName(d)}"?`,
			message: d.state === 'done' ? 'Its file goes from this computer.' : 'Its download stops.',
			confirmLabel: 'Delete'
		});
		if (!yes) return;
		downloads = (downloads ?? []).filter((x) => x.id !== d.id);
		await fetch(`/api/downloads/${d.id}`, { method: 'DELETE' }).catch(() => {});
		load();
	}

	async function retry(d: Download) {
		await fetch(`/api/downloads/${d.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ retry: true }) }).catch(() => {});
		load();
	}

	const used = $derived((downloads ?? []).filter((d) => d.state === 'done').reduce((sum, d) => sum + d.bytes, 0));
</script>

<svelte:head><title>Downloads · Catalog</title></svelte:head>

<BackBar />

<div class="downloads">
	<header>
		<h1>Downloads</h1>
		{#if downloads?.length}
			<p class="faint">{size(used)} on this computer{free !== null ? ` · ${size(free)} free` : ''}</p>
		{/if}
	</header>

	{#if plainPhone}
		<div class="offline-how">
			<strong>Watching with no connection</strong>
			{#if secureAddress && inApp}
				<p>
					Connect the app to {secureAddress.replace('https://', '')} (Settings → Phones → Connect to another computer),
					then press Keep on this phone on a download while still connected. Kept ones play in airplane mode.
				</p>
			{:else if secureAddress}
				<p>
					Open Catalog at <a href={`${secureAddress}/downloads`}>{secureAddress.replace('https://', '')}</a>, add it to
					the Home Screen, then press Keep on this phone on a download while still connected. Kept ones play in airplane
					mode from the Home Screen icon.
				</p>
			{:else}
				<p>
					On the computer, turn on Settings → Phones, then open Catalog on this phone from the address it shows and
					press Keep on this phone on a download. This address only works while the phone can reach the computer.
				</p>
			{/if}
		</div>
	{/if}

	{#if !downloads}
		<p class="faint">{failed ? "Downloads can't be reached right now." : 'Loading…'}</p>
	{:else if !downloads.length}
		<p class="faint">Nothing downloaded yet. Download on a title's page (a film, a season or a whole show), or in the player, keeps it here to watch without the internet.</p>
	{:else}
		<ul>
			{#each downloads as d (d.id)}
				<li class:failed={d.state === 'failed'}>
					{#if d.state === 'done'}
						<a class="poster" href="/watch?download={d.id}" aria-label="Play {downloadName(d)}">
							{#if d.poster}<img src={d.poster} alt="" loading="lazy" />{/if}
						</a>
					{:else}
						<span class="poster">{#if d.poster}<img src={d.poster} alt="" loading="lazy" />{/if}</span>
					{/if}
					<div class="about">
						<span class="name">{downloadName(d)}</span>
						{#if d.episodeName}<span class="episode-name">{d.episodeName}</span>{/if}
						<span class="status">{status(d)}</span>
						{#if d.state === 'downloading' || (d.state === 'waiting' && d.donePieces)}
							<span class="bar"><span style:width="{pct(d)}%"></span></span>
						{:else if d.id in kept.saving}
							<span class="bar"><span style:width="{Math.floor(((kept.saving[d.id] ?? 0) / Math.max(1, d.bytes)) * 100)}%"></span></span>
						{/if}
						{#if kept.problems[d.id]}<span class="status problem">{kept.problems[d.id]}</span>{/if}
					</div>
					<div class="actions">
						{#if d.state === 'done'}
							{#if phoneApp && kept.ids.includes(d.id)}
								<!-- the copy on the phone: Catalog's own player plays from it (no data used) -->
								<a class="btn btn-primary" href="/watch?download={d.id}">Play</a>
								<span class="on-phone">On this phone</span>
								<button type="button" class="btn" onclick={() => unkeep(d)}>Remove from phone</button>
							{:else if phoneApp}
								<a class="btn btn-primary" href="/watch?download={d.id}">Play</a>
								{#if d.id in kept.saving}
									<button type="button" class="btn" onclick={() => stopKeeping(d.id)}>Stop saving</button>
								{:else}
									<button type="button" class="btn" onclick={() => keep(d)}>Keep on this phone</button>
								{/if}
							{:else}
								<a class="btn btn-primary" href="/watch?download={d.id}">Play</a>
								{#if !inApp}
									<a class="btn" href="/api/downloads/{d.id}/file?save=1" download>Save to this device</a>
									{#if d.hasSubtitles}<a class="btn" href="/api/downloads/{d.id}/subtitles?save=1" download>Subtitles</a>{/if}
								{/if}
							{/if}
							{#if inApp}
								<!-- The iPhone app: a copy in the phone's Files app is there for whoever wants it, never the main way. -->
								<details class="files">
									<summary class="btn">More</summary>
									<div>
										<a class="btn" href="/api/downloads/{d.id}/file?save=1" download>Save a copy to Files</a>
										{#if d.hasSubtitles}<a class="btn" href="/api/downloads/{d.id}/subtitles?save=1" download>Save its subtitles to Files</a>{/if}
									</div>
								</details>
							{/if}
						{:else if d.state === 'failed'}
							<button type="button" class="btn" onclick={() => retry(d)}>Try again</button>
						{/if}
						<button type="button" class="btn" onclick={() => remove(d)}>Delete</button>
					</div>
				</li>
			{/each}
		</ul>
		{#if phoneApp && inApp}
			<p class="faint small">Kept on this phone, a download plays here with no data used, and with no connection at all: open Catalog and it's listed. Keep Catalog open while one saves.</p>
		{:else if inApp}
			<p class="faint small">To keep downloads on this phone, the app has to be connected to the computer's secure address (Settings → Phones).</p>
		{:else if phoneApp}
			<p class="faint small">Kept on this phone, a download plays with no connection: open Catalog from the Home Screen and it's listed there. Keep Catalog open while one saves.</p>
		{:else}
			<p class="faint small">On an iPhone, a video saved to this device is in the Files app, under Downloads.</p>
		{/if}
	{/if}

	{#if ahead.length}
		<section class="ahead">
			<h2>On this computer for now</h2>
			<p class="faint small">
				Fetched ahead so they play without waiting. With all of one here it keeps playing if the internet drops
				partway. They go by themselves; Keep makes one a download.
			</p>
			<ul>
				{#each ahead as a (a.share)}
					<li>
						<a class="poster" href={aheadHref(a)} aria-label="Play {aheadName(a)}">
							{#if a.poster}<img src={a.poster} alt="" loading="lazy" />{/if}
						</a>
						<div class="about">
							<span class="name">{aheadName(a)}</span>
							<span class="status">{aheadStatus(a)}</span>
							{#if !aheadAll(a) && a.total}
								<span class="bar"><span style:width="{Math.floor((a.here / a.total) * 100)}%"></span></span>
							{/if}
						</div>
						<div class="actions">
							{#if a.title}<a class="btn btn-primary" href={aheadHref(a)}>Play</a>{/if}
							{#if a.title && aheadAll(a)}
								<button type="button" class="btn" disabled={keeping.includes(a.share)} onclick={() => keepAhead(a)}>{keeping.includes(a.share) ? 'Keeping…' : 'Keep'}</button>
							{/if}
							<button type="button" class="btn" disabled={a.busy} onclick={() => removeAhead(a)}>Remove</button>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.ahead {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 10px;
	}

	.ahead h2 {
		margin: 0;
		font-size: 1.05rem;
	}

	.ahead p {
		margin: 0;
		max-width: 62ch;
	}

	.downloads {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.offline-how {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px 14px;
		border-radius: var(--radius);
		background: var(--accent-bg);
		font-size: 0.92rem;
	}

	.offline-how p {
		margin: 0;
		color: var(--ink-soft);
		line-height: 1.5;
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px 14px;
	}

	h1 {
		margin: 0;
	}

	.faint {
		margin: 0;
		color: var(--ink-faint);
	}

	.status.problem {
		color: var(--accent);
	}

	.small {
		font-size: 0.85rem;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	li {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 10px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--card, var(--paper));
	}

	.poster {
		flex: none;
		width: 56px;
		height: 84px;
		border-radius: 6px;
		overflow: hidden;
		background: var(--rule);
	}

	.poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.about {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.name {
		font-weight: 600;
	}

	.episode-name,
	.status {
		font-size: 0.88rem;
		color: var(--ink-soft);
	}

	li.failed .status {
		color: var(--warn);
	}

	.bar {
		height: 4px;
		margin-top: 4px;
		border-radius: 2px;
		background: var(--rule);
		overflow: hidden;
	}

	.bar span {
		display: block;
		height: 100%;
		background: var(--accent);
		transition: width 0.4s;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 6px;
	}

	/* A download that's also on this phone. */
	.on-phone {
		align-self: center;
		font-size: 0.8rem;
		color: var(--ink-soft);
	}

	/* The iPhone app's "More": saving a copy into the phone's Files app. */
	.files {
		position: relative;
	}

	.files summary {
		list-style: none;
		cursor: pointer;
	}

	.files summary::-webkit-details-marker {
		display: none;
	}

	.files > div {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 6px;
	}

	@media (max-width: 640px) {
		li {
			flex-wrap: wrap;
		}

		.actions {
			width: 100%;
			justify-content: flex-start;
		}
	}
</style>
