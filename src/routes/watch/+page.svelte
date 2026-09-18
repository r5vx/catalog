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

	interface Episode {
		season: number;
		episode: number;
		fid: number;
		name: string;
		size: string;
		quality: string;
	}

	let query = $state('');
	let results = $state<Result[]>([]);
	let searching = $state(false);
	let searched = $state(false);
	let problem = $state('');

	let febboxUrl = $state('');
	let activeTitle = $state('');
	let activeResult = $state<Result | null>(null);
	let loadingLink = $state<number | null>(null);
	let iframeLoading = $state(false);

	let episodes = $state<Episode[]>([]);
	let seasons = $state<number[]>([]);
	let activeSeason = $state(1);
	let loadingEpisodes = $state(false);
	let activeEpisode = $state<Episode | null>(null);
	let sidebarOpen = $state(true);

	let autoMatch = false;
	let autoType = '';
	let autoYear = '';

	let searchTimer: ReturnType<typeof setTimeout>;

	onMount(() => {
		const title = page.url.searchParams.get('title');
		autoMatch = page.url.searchParams.get('auto') === '1';
		autoType = page.url.searchParams.get('type') ?? '';
		autoYear = page.url.searchParams.get('year') ?? '';
		if (title && title.trim()) {
			query = title;
			doSearch(title);
		}
	});

	function onSearch(event: Event) {
		clearTimeout(searchTimer);
		const value = (event.target as HTMLInputElement).value;
		query = value;
		searchTimer = setTimeout(() => doSearch(value), 350);
	}

	function bestMatch(items: Result[]): Result | null {
		if (!items.length) return null;

		const want = query.toLowerCase().trim();

		for (const r of items) {
			const t = r.title.toLowerCase();
			const typeOk = !autoType || r.type === autoType;
			const yearOk = !autoYear || r.info.includes(autoYear);
			if (t === want && typeOk && yearOk) return r;
		}

		for (const r of items) {
			const t = r.title.toLowerCase();
			const typeOk = !autoType || r.type === autoType;
			if (t === want && typeOk) return r;
		}

		if (autoType) {
			const typed = items.filter((r) => r.type === autoType);
			if (typed.length) return typed[0];
		}

		return items[0];
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

			if (autoMatch && results.length) {
				autoMatch = false;
				const pick = bestMatch(results);
				if (pick) watch(pick);
			}
		} catch {
			problem = 'Search failed. Try again in a moment.';
		} finally {
			searching = false;
		}
	}

	async function watch(result: Result) {
		loadingLink = result.id;
		problem = '';

		try {
			const resp = await fetch(`/api/watch/link?id=${result.id}&type=${result.type}`);
			if (!resp.ok) throw new Error();
			const data = await resp.json();

			if (data.link) {
				febboxUrl = data.link;
				activeTitle = result.title;
				activeResult = result;
				iframeLoading = true;

				if (result.type === 'tv') fetchEpisodes(result.id);
			} else {
				problem = 'No link available for that title.';
			}
		} catch {
			problem = 'Could not get the link. Try again in a moment.';
		} finally {
			loadingLink = null;
		}
	}

	async function fetchEpisodes(showboxId: number) {
		loadingEpisodes = true;
		try {
			const resp = await fetch(`/api/watch/episodes?id=${showboxId}&type=tv`);
			if (!resp.ok) throw new Error();
			const data = await resp.json();
			seasons = data.seasons;
			episodes = data.episodes;
			if (seasons.length) activeSeason = seasons[0];
		} catch {
			episodes = [];
			seasons = [];
		} finally {
			loadingEpisodes = false;
		}
	}

	const seasonEpisodes = $derived(
		episodes.filter((ep) => ep.season === activeSeason)
	);

	function playEpisode(ep: Episode) {
		activeEpisode = ep;
		activeTitle = `${activeResult?.title ?? ''} S${ep.season}E${ep.episode}`;
	}

	function backToResults() {
		febboxUrl = '';
		activeTitle = '';
		activeResult = null;
		episodes = [];
		seasons = [];
		activeEpisode = null;
	}

	function loginToFebbox() {
		const popup = window.open('https://www.febbox.com/login', '_blank');
		if (!popup) return;
		const poll = setInterval(() => {
			if (popup.closed) {
				clearInterval(poll);
				reloadPlayer();
			}
		}, 500);
	}

	function reloadPlayer() {
		const url = febboxUrl;
		febboxUrl = '';
		iframeLoading = true;
		setTimeout(() => { febboxUrl = url; }, 100);
	}
</script>

<svelte:head><title>{activeTitle ? `${activeTitle} · ` : ''}Watch · Catalog</title></svelte:head>

{#if febboxUrl}
	<div class="player-page" class:has-sidebar={activeResult?.type === 'tv' && seasons.length > 0 && sidebarOpen}>
		<div class="player-bar">
			<button type="button" class="bar-btn" onclick={backToResults}>&larr; Back</button>
			<h1 class="player-title">{activeTitle}</h1>
			{#if activeResult?.type === 'tv' && seasons.length > 0}
				<button
					type="button"
					class="bar-btn episodes-btn"
					onclick={() => sidebarOpen = !sidebarOpen}
				>{sidebarOpen ? 'Hide episodes' : 'Episodes'}</button>
			{/if}
			<button type="button" class="bar-btn login-btn" onclick={loginToFebbox}>Log in</button>
			<a
				href="/entry/new?q={encodeURIComponent(activeResult?.title ?? activeTitle)}"
				class="bar-btn add-btn"
			>+ Add to library</a>
		</div>

		<div class="player-body">
			{#if activeResult?.type === 'tv' && seasons.length > 0 && sidebarOpen}
				<aside class="sidebar">
					<div class="season-tabs">
						{#each seasons as s (s)}
							<button
								type="button"
								class="season-tab"
								class:active={activeSeason === s}
								onclick={() => activeSeason = s}
							>S{s}</button>
						{/each}
					</div>
					<ul class="episode-list">
						{#if loadingEpisodes}
							<li class="ep-loading">Loading episodes…</li>
						{:else}
							{#each seasonEpisodes as ep (ep.fid)}
								<li>
									<button
										type="button"
										class="ep-btn"
										class:playing={activeEpisode?.fid === ep.fid}
										onclick={() => playEpisode(ep)}
									>
										<span class="ep-num">E{ep.episode}</span>
										<span class="ep-meta">
											<span class="ep-quality">{ep.quality || 'SD'}</span>
											<span class="ep-size">{ep.size}</span>
										</span>
									</button>
								</li>
							{/each}
						{/if}
					</ul>
				</aside>
			{/if}

			<div class="player" class:buffering={iframeLoading}>
				{#if iframeLoading}
					<p class="player-status">Loading…</p>
				{/if}
				<iframe
					src={febboxUrl}
					title={activeTitle}
					allowfullscreen
					onload={() => { iframeLoading = false; }}
				></iframe>
			</div>
		</div>
	</div>
{:else}
	<BackBar />

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

	{#if problem}
		<p class="msg bad" role="alert">{problem}</p>
	{/if}

	{#if searching}
		<p class="muted searching">Searching…</p>
	{:else if results.length > 0}
		<ul class="grid">
			{#each results as result (result.id + result.type)}
				<li>
					<button
						type="button"
						class="card"
						disabled={loadingLink === result.id}
						onclick={() => watch(result)}
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
						{#if loadingLink === result.id}
							<span class="loading-label">Opening…</span>
						{/if}
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

<style>
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

	.loading-label {
		font-size: 0.76rem;
		color: var(--accent);
		font-weight: 600;
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
		gap: 14px;
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

	.login-btn {
		color: var(--ink-soft);
		font-size: 0.78rem;
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

	.ep-loading {
		padding: 16px;
		text-align: center;
		color: var(--ink-faint);
		font-size: 0.82rem;
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

	.ep-num {
		font-weight: 700;
		min-width: 2.2em;
	}

	.ep-meta {
		display: flex;
		gap: 8px;
		margin-left: auto;
		font-size: 0.72rem;
		color: var(--ink-faint);
	}

	.ep-quality {
		text-transform: uppercase;
		font-weight: 600;
	}

	/* --------------------------------------------------------- player */

	.player {
		position: relative;
		flex: 1;
		background: #111;
		min-height: 0;
	}

	.player iframe {
		display: block;
		width: 100%;
		height: 100%;
		border: none;
	}

	.player-status {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		margin: 0;
		font-size: 0.9rem;
		color: #888;
	}

	.buffering iframe {
		opacity: 0.3;
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
