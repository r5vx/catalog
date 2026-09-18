<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import BackBar from '$lib/BackBar.svelte';

	interface Result {
		id: number;
		type: 'movie' | 'tv';
		title: string;
		posterUrl: string;
		info: string;
	}

	interface FileOption {
		fid: number;
		quality: string;
		name: string;
		size: string;
	}

	interface Episode {
		season: number;
		episode: number;
		files: FileOption[];
	}

	let loading = $state(true);
	let problem = $state('');
	let debugInfo = $state('');
	let streamUrl = $state('');
	let videoTitle = $state('');
	let showType = $state<'movie' | 'tv'>('movie');
	let shareKey = $state('');
	let hasToken = $state(false);
	let needsToken = $state(false);

	let movieFiles = $state<FileOption[]>([]);
	let episodes = $state<Episode[]>([]);
	let seasons = $state<number[]>([]);
	let allQualities = $state<string[]>([]);
	let activeSeason = $state(1);
	let activeEpisode = $state<Episode | null>(null);
	let activeQuality = $state('');
	let preferredQuality = $state('1080p');
	let sidebarOpen = $state(true);
	let loadingEpisode = $state(false);
	let changingQuality = $state(false);

	let query = $state('');
	let results = $state<Result[]>([]);
	let searching = $state(false);
	let searched = $state(false);
	let resolving = $state(false);
	let isAuto = false;

	let searchTimer: ReturnType<typeof setTimeout>;
	let videoEl: HTMLVideoElement | undefined = $state();

	const seasonEpisodes = $derived(episodes.filter((ep) => ep.season === activeSeason));

	const currentFiles = $derived(
		showType === 'tv' && activeEpisode ? activeEpisode.files : movieFiles
	);

	const availableQualities = $derived(
		[...new Set(currentFiles.map((f) => f.quality).filter(Boolean))].sort(
			(a, b) => parseInt(b) - parseInt(a)
		)
	);

	onMount(async () => {
		const title = page.url.searchParams.get('title');
		isAuto = page.url.searchParams.get('auto') === '1';
		const type = page.url.searchParams.get('type') ?? '';
		const year = page.url.searchParams.get('year') ?? '';

		if (title && isAuto) {
			videoTitle = title;
			await resolve(title, type, year);
		} else if (title) {
			query = title;
			loading = false;
			doSearch(title);
		} else {
			loading = false;
		}
	});

	function pickFile(files: FileOption[], wanted: string): FileOption | null {
		if (!files.length) return null;
		const exact = files.find((f) => f.quality === wanted);
		if (exact) return exact;

		const target = parseInt(wanted) || 1080;
		return files.reduce((best, f) => {
			const bestDiff = Math.abs((parseInt(best.quality) || 0) - target);
			const fDiff = Math.abs((parseInt(f.quality) || 0) - target);
			return fDiff < bestDiff ? f : best;
		});
	}

	async function resolve(title: string, type: string, year: string) {
		loading = true;
		problem = '';
		debugInfo = '';

		try {
			const params = new URLSearchParams({ title });
			if (type) params.set('type', type);
			if (year) params.set('year', year);

			const resp = await fetch(`/api/watch/resolve?${params}`);
			if (!resp.ok) throw new Error();
			const data = await resp.json();

			if (data.error) {
				if (data.error === 'not_found') problem = 'Nothing found for that title.';
				else if (data.error === 'no_link') problem = 'No link available for that title.';
				else if (data.error === 'no_file') problem = 'No video file found.';
				else problem = 'Something went wrong.';
				loading = false;
				return;
			}

			videoTitle = data.title;
			showType = data.type;
			shareKey = data.shareKey;
			hasToken = data.hasToken;

			if (data.files) {
				movieFiles = data.files;
			}

			if (data.episodes) {
				episodes = data.episodes.episodes;
				seasons = data.episodes.seasons;
				allQualities = data.episodes.qualities ?? [];
				if (seasons.length) activeSeason = seasons[0];
				if (episodes.length) activeEpisode = episodes[0];
			}

			if (data.streamUrl) {
				streamUrl = data.streamUrl;
				const activeFile = currentFiles.find((f) => f.fid === data.fid);
				activeQuality = activeFile?.quality ?? currentFiles[0]?.quality ?? '';
			} else if (!data.hasToken) {
				needsToken = true;
				problem = 'Add your key in Settings → Services to start watching.';
			} else {
				problem = 'Could not get a playable link for this title.';
				if (data.debug) debugInfo = data.debug;
			}
		} catch {
			problem = 'Could not load that title. Try again in a moment.';
		} finally {
			loading = false;
		}
	}

	async function changeQuality(quality: string) {
		const file = pickFile(currentFiles, quality);
		if (!file || file.fid === (currentFiles.find((f) => f.quality === activeQuality)?.fid)) return;

		changingQuality = true;
		preferredQuality = quality;

		try {
			const resp = await fetch(`/api/watch/stream?share_key=${shareKey}&fid=${file.fid}`);
			if (!resp.ok) throw new Error();
			const data = await resp.json();

			if (data.url) {
				streamUrl = data.url;
				activeQuality = quality;
			} else {
				problem = 'Could not get that quality.';
				if (data.debug) debugInfo = data.debug;
			}
		} catch {
			problem = 'Failed to switch quality.';
		} finally {
			changingQuality = false;
		}
	}

	async function playEpisode(ep: Episode) {
		if (loadingEpisode || ep === activeEpisode) return;
		loadingEpisode = true;
		activeEpisode = ep;
		problem = '';

		const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
		const file = pickFile(ep.files, preferredQuality);

		if (!file) {
			problem = 'No video file for that episode.';
			loadingEpisode = false;
			return;
		}

		try {
			const resp = await fetch(`/api/watch/stream?share_key=${shareKey}&fid=${file.fid}`);
			if (!resp.ok) throw new Error();
			const data = await resp.json();

			if (data.url) {
				streamUrl = data.url;
				videoTitle = `${baseTitle} S${ep.season}E${ep.episode}`;
				activeQuality = file.quality;
			} else {
				problem = 'Could not get a link for that episode.';
				if (data.debug) debugInfo = data.debug;
			}
		} catch {
			problem = 'Failed to load episode.';
		} finally {
			loadingEpisode = false;
		}
	}

	function onSearch(event: Event) {
		clearTimeout(searchTimer);
		const value = (event.target as HTMLInputElement).value;
		query = value;
		searchTimer = setTimeout(() => doSearch(value), 350);
	}

	async function doSearch(q: string) {
		q = q.trim();
		if (!q) {
			results = [];
			searched = false;
			return;
		}

		searching = true;
		problem = '';

		try {
			const resp = await fetch(`/api/watch/search?q=${encodeURIComponent(q)}`);
			if (!resp.ok) throw new Error();
			results = await resp.json();
			searched = true;
		} catch {
			problem = 'Search failed. Try again in a moment.';
		} finally {
			searching = false;
		}
	}

	async function watchResult(result: Result) {
		resolving = true;
		videoTitle = result.title;
		await resolve(result.title, result.type, '');
		resolving = false;
	}

	function backToSearch() {
		streamUrl = '';
		videoTitle = '';
		problem = '';
		debugInfo = '';
		episodes = [];
		seasons = [];
		movieFiles = [];
		activeEpisode = null;
		loading = false;
	}
</script>

<svelte:head><title>{videoTitle ? `${videoTitle} · ` : ''}Watch · Catalog</title></svelte:head>

{#if streamUrl}
	<div class="player-page" class:has-sidebar={showType === 'tv' && seasons.length > 0 && sidebarOpen}>
		<div class="player-bar">
			<button type="button" class="bar-btn" onclick={backToSearch}>&larr; Back</button>
			<h1 class="player-title">{videoTitle}</h1>
			{#if availableQualities.length > 1}
				<div class="quality-picker">
					{#each availableQualities as q (q)}
						<button
							type="button"
							class="q-btn"
							class:active={activeQuality === q}
							disabled={changingQuality}
							onclick={() => changeQuality(q)}
						>{q}</button>
					{/each}
				</div>
			{/if}
			{#if showType === 'tv' && seasons.length > 0}
				<button
					type="button"
					class="bar-btn episodes-btn"
					onclick={() => (sidebarOpen = !sidebarOpen)}
				>{sidebarOpen ? 'Hide episodes' : 'Episodes'}</button>
			{/if}
			<a
				href="/entry/new?q={encodeURIComponent(videoTitle.replace(/ S\d+E\d+$/, ''))}"
				class="bar-btn add-btn"
			>+ Add to library</a>
		</div>

		{#if problem}
			<p class="player-error">{problem}</p>
		{/if}

		<div class="player-body">
			{#if showType === 'tv' && seasons.length > 0 && sidebarOpen}
				<aside class="sidebar">
					<div class="season-tabs">
						{#each seasons as s (s)}
							<button
								type="button"
								class="season-tab"
								class:active={activeSeason === s}
								onclick={() => (activeSeason = s)}
							>S{s}</button>
						{/each}
					</div>
					<ul class="episode-list">
						{#each seasonEpisodes as ep (`${ep.season}-${ep.episode}`)}
							<li>
								<button
									type="button"
									class="ep-btn"
									class:playing={activeEpisode === ep}
									disabled={loadingEpisode}
									onclick={() => playEpisode(ep)}
								>
									<span class="ep-num">E{ep.episode}</span>
									<span class="ep-meta">
										{#each ep.files as f (f.fid)}
											<span class="ep-quality">{f.quality || 'SD'}</span>
										{/each}
									</span>
								</button>
							</li>
						{/each}
					</ul>
				</aside>
			{/if}

			<div class="player">
				{#if loadingEpisode || changingQuality}
					<p class="player-status">{changingQuality ? 'Switching quality…' : 'Loading episode…'}</p>
				{/if}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					bind:this={videoEl}
					src={streamUrl}
					controls
					autoplay
					class:buffering={loadingEpisode || changingQuality}
				>
					Your browser doesn't support video playback.
				</video>
			</div>
		</div>
	</div>
{:else if loading || resolving}
	<BackBar />
	<div class="loading-page">
		<div class="spinner"></div>
		<p>Loading {videoTitle || 'video'}…</p>
	</div>
{:else}
	<BackBar />

	{#if problem}
		<div class="problem-page">
			<p class="msg bad" role="alert">{problem}</p>
			{#if debugInfo}
				<details class="debug-details">
					<summary>Details</summary>
					<pre class="debug-pre">{debugInfo}</pre>
				</details>
			{/if}
			{#if needsToken}
				<a href="/settings/services" class="btn btn-primary">Go to Settings</a>
			{/if}
		</div>
	{/if}

	{#if !needsToken && !problem}
		<header class="masthead">
			<h1>Watch</h1>
		</header>

		<div class="toolbar">
			<input
				type="search"
				placeholder="Search for a movie or show…"
				value={query}
				oninput={onSearch}
				aria-label="Search for media"
			/>
		</div>

		{#if searching}
			<p class="muted searching">Searching…</p>
		{:else if results.length > 0}
			<ul class="grid">
				{#each results as result (result.id + result.type)}
					<li>
						<button
							type="button"
							class="card"
							disabled={resolving}
							onclick={() => watchResult(result)}
						>
							<div class="poster">
								{#if result.posterUrl}
									<img src={result.posterUrl} alt="" loading="lazy" />
								{:else}
									<span class="fallback" aria-hidden="true">?</span>
								{/if}
								<span class="kind">{result.type === 'tv' ? 'TV' : 'Film'}</span>
							</div>
							<h3 class="name">{result.title}</h3>
							<p class="sub faint">{result.info}</p>
						</button>
					</li>
				{/each}
			</ul>
		{:else if searched}
			<p class="empty-msg muted">Nothing found for that.</p>
		{:else if !page.url.searchParams.get('title')}
			<div class="empty">
				<h2>Search for something to watch</h2>
				<p class="muted">Find a movie or show, then watch it right here.</p>
			</div>
		{/if}
	{/if}
{/if}

<style>
	/* --------------------------------------------------------- loading */

	.loading-page {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 18px;
		padding: 120px 20px;
		text-align: center;
		color: var(--ink-soft);
	}

	.spinner {
		width: 36px;
		height: 36px;
		border: 3px solid var(--rule);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.problem-page {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		padding: 60px 20px 30px;
		text-align: center;
	}

	.debug-details {
		max-width: 520px;
		width: 100%;
		text-align: left;
	}

	.debug-details summary {
		font-size: 0.82rem;
		color: var(--ink-faint);
		cursor: pointer;
	}

	.debug-pre {
		font-size: 0.76rem;
		color: var(--ink-faint);
		background: var(--sunk);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		padding: 10px 12px;
		white-space: pre-wrap;
		word-break: break-all;
		margin-top: 6px;
	}

	/* --------------------------------------------------------- search view */

	.masthead {
		margin-bottom: 18px;
	}

	.masthead h1 {
		font-size: clamp(1.5rem, 4vw, 2rem);
	}

	.toolbar {
		margin-bottom: 20px;
	}

	.toolbar input {
		width: 100%;
	}

	.msg {
		border: 1px solid var(--accent);
		border-radius: var(--radius-sm);
		padding: 9px 13px;
		margin: 0 0 18px;
		font-size: 0.88rem;
		color: var(--accent);
		background: var(--surface);
		max-width: 480px;
	}

	.searching {
		margin: 24px 0;
		text-align: center;
	}

	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 24px 16px;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 7px;
		width: 100%;
		padding: 0;
		background: none;
		border: none;
		text-align: left;
		cursor: pointer;
	}

	.card:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.poster {
		position: relative;
		aspect-ratio: 2 / 3;
		background: var(--surface-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		overflow: hidden;
		display: grid;
		place-items: center;
		transition:
			border-color 0.14s ease,
			transform 0.14s ease;
	}

	.card:hover .poster {
		border-color: var(--accent);
		transform: translateY(-2px);
	}

	.poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.fallback {
		font-size: 1.8rem;
		opacity: 0.4;
	}

	.kind {
		position: absolute;
		top: 6px;
		left: 6px;
		font-size: 0.68rem;
		font-weight: 700;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: var(--sunk);
		color: var(--ink-soft);
		border: 1px solid var(--rule);
		text-transform: uppercase;
	}

	.name {
		font-family: var(--body);
		font-size: 0.9rem;
		font-weight: 600;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}

	.sub {
		font-size: 0.78rem;
		margin: 0;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		text-align: center;
		padding: 72px 20px;
		border: 1px dashed var(--rule-firm);
		border-radius: var(--radius);
	}

	.empty h2 {
		font-size: 1.3rem;
	}

	.empty-msg {
		margin-top: 34px;
		text-align: center;
	}

	/* --------------------------------------------------------- player view */

	.player-page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		margin: -20px -20px 0;
		overflow: hidden;
	}

	.player-bar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 16px;
		background: var(--sunk);
		border-bottom: 1px solid var(--rule);
		flex: none;
	}

	.bar-btn {
		flex: none;
		font-size: 0.82rem;
		font-weight: 600;
		padding: 5px 12px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--rule);
		background: var(--surface);
		color: var(--ink);
		cursor: pointer;
		text-decoration: none;
		white-space: nowrap;
	}

	.bar-btn:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.episodes-btn {
		color: var(--accent);
		border-color: var(--accent);
		font-size: 0.78rem;
	}

	.add-btn {
		margin-left: auto;
		background: var(--good);
		color: var(--paper);
		border-color: var(--good);
	}

	.add-btn:hover {
		filter: brightness(1.12);
		color: var(--paper);
	}

	.player-title {
		font-size: 1rem;
		font-weight: 600;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.player-error {
		margin: 0;
		padding: 6px 16px;
		font-size: 0.82rem;
		color: var(--accent);
		background: var(--accent-bg);
		border-bottom: 1px solid var(--rule);
	}

	/* --------------------------------------------------------- quality picker */

	.quality-picker {
		display: flex;
		gap: 3px;
		flex: none;
	}

	.q-btn {
		font-size: 0.72rem;
		font-weight: 700;
		padding: 3px 8px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--rule);
		background: var(--surface);
		color: var(--ink-soft);
		cursor: pointer;
		text-transform: uppercase;
	}

	.q-btn:hover:not(.active) {
		border-color: var(--ink-faint);
		color: var(--ink);
	}

	.q-btn.active {
		background: var(--accent);
		color: var(--accent-ink);
		border-color: var(--accent);
	}

	.q-btn:disabled {
		opacity: 0.5;
		cursor: wait;
	}

	/* --------------------------------------------------------- player body */

	.player-body {
		display: flex;
		flex: 1;
		min-height: 0;
	}

	/* --------------------------------------------------------- sidebar */

	.sidebar {
		width: 240px;
		flex: none;
		display: flex;
		flex-direction: column;
		background: var(--sunk);
		border-right: 1px solid var(--rule);
		overflow: hidden;
	}

	.season-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		padding: 8px 10px;
		border-bottom: 1px solid var(--rule);
	}

	.season-tab {
		padding: 4px 10px;
		font-size: 0.76rem;
		font-weight: 600;
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--ink-soft);
		cursor: pointer;
	}

	.season-tab.active {
		background: var(--accent);
		color: var(--accent-ink);
		border-color: var(--accent);
	}

	.season-tab:hover:not(.active) {
		border-color: var(--ink-faint);
	}

	.episode-list {
		list-style: none;
		margin: 0;
		padding: 4px 0;
		overflow-y: auto;
		flex: 1;
	}

	.ep-btn {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 9px 14px;
		border: none;
		background: none;
		color: var(--ink);
		cursor: pointer;
		text-align: left;
		font-size: 0.84rem;
	}

	.ep-btn:hover {
		background: var(--surface);
	}

	.ep-btn.playing {
		background: var(--accent-bg);
		color: var(--accent);
	}

	.ep-btn:disabled {
		opacity: 0.5;
		cursor: wait;
	}

	.ep-num {
		font-weight: 700;
		min-width: 2.2em;
	}

	.ep-meta {
		display: flex;
		gap: 4px;
		margin-left: auto;
		font-size: 0.68rem;
		color: var(--ink-faint);
	}

	.ep-quality {
		text-transform: uppercase;
		font-weight: 600;
		padding: 1px 4px;
		border-radius: 3px;
		background: var(--surface);
		border: 1px solid var(--rule);
	}

	/* --------------------------------------------------------- player */

	.player {
		position: relative;
		flex: 1;
		background: #000;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.player video {
		width: 100%;
		height: 100%;
		display: block;
		outline: none;
	}

	.player video.buffering {
		opacity: 0.3;
	}

	.player-status {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		margin: 0;
		font-size: 0.9rem;
		color: #888;
		z-index: 1;
	}

	@media (max-width: 700px) {
		.sidebar {
			width: 180px;
		}
	}

	@media (max-width: 560px) {
		.player-bar {
			flex-wrap: wrap;
			gap: 8px;
		}

		.player-title {
			order: -1;
			width: 100%;
			font-size: 0.9rem;
		}

		.quality-picker {
			order: 1;
		}

		.add-btn {
			margin-left: 0;
			flex: 1;
			text-align: center;
		}

		.player-body {
			flex-direction: column;
		}

		.sidebar {
			width: 100%;
			max-height: 200px;
			border-right: none;
			border-bottom: 1px solid var(--rule);
		}
	}
</style>
