<script lang="ts">
	/**
	 * Downloads (src/lib/server/downloads.ts): films, episodes and replays kept on the computer,
	 * started from Download in the player. Each plays here with no internet, or can be saved onto
	 * this device (a phone: an iPhone keeps it in the Files app) with its subtitles beside it.
	 * Asks every two seconds while one is downloading.
	 */
	import { onDestroy, onMount } from 'svelte';
	import { confirmAction } from '$lib/confirm.svelte';
	import { downloadName } from '$lib/downloadName';

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
	}

	let timer: ReturnType<typeof setInterval> | undefined;
	onMount(() => {
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
			return [left, quality, size(d.bytes), d.source].filter(Boolean).join(' · ');
		}
		if (d.state === 'waiting') return d.donePieces ? `Waiting · ${pct(d)}%` : 'Waiting';
		if (d.state === 'finishing') return 'Making the file';
		if (d.state === 'failed') return d.error ?? "Couldn't download";
		const speed = d.speed ? ` · ${(d.speed / 1024 ** 2).toFixed(1)} MB/s` : '';
		return `${pct(d)}% · ${size(d.bytes)}${d.estimate ? ` of about ${size(d.estimate)}` : ''}${speed}`;
	}
	const pct = (d: Download) => (d.totalPieces ? Math.floor((d.donePieces / d.totalPieces) * 100) : 0);

	async function remove(d: Download) {
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

<div class="downloads">
	<header>
		<h1>Downloads</h1>
		{#if downloads?.length}
			<p class="faint">{size(used)} on this computer{free !== null ? ` · ${size(free)} free` : ''}</p>
		{/if}
	</header>

	{#if !downloads}
		<p class="faint">{failed ? "Downloads can't be reached right now." : 'Loading…'}</p>
	{:else if !downloads.length}
		<p class="faint">Nothing downloaded yet. Download in the player keeps a film, episode or replay here to watch without the internet.</p>
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
						{/if}
					</div>
					<div class="actions">
						{#if d.state === 'done'}
							<a class="btn btn-primary" href="/watch?download={d.id}">Play</a>
							<a class="btn" href="/api/downloads/{d.id}/file?save=1" download>Save to this device</a>
							{#if d.hasSubtitles}<a class="btn" href="/api/downloads/{d.id}/subtitles?save=1" download>Subtitles</a>{/if}
						{:else if d.state === 'failed'}
							<button type="button" class="btn" onclick={() => retry(d)}>Try again</button>
						{/if}
						<button type="button" class="btn" onclick={() => remove(d)}>Delete</button>
					</div>
				</li>
			{/each}
		</ul>
		<p class="faint small">On an iPhone, a video saved to this device is in the Files app, under Downloads.</p>
	{/if}
</div>

<style>
	.downloads {
		display: flex;
		flex-direction: column;
		gap: 18px;
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
