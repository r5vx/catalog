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

	let query = $state('');
	let results = $state<Result[]>([]);
	let searching = $state(false);
	let searched = $state(false);
	let problem = $state('');

	let febboxUrl = $state('');
	let activeTitle = $state('');
	let loadingLink = $state<number | null>(null);
	let iframeLoading = $state(false);

	let searchTimer: ReturnType<typeof setTimeout>;

	onMount(() => {
		const title = page.url.searchParams.get('title');
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
				iframeLoading = true;
			} else {
				problem = 'No link available for that title.';
			}
		} catch {
			problem = 'Could not get the link. Try again in a moment.';
		} finally {
			loadingLink = null;
		}
	}

	function backToResults() {
		febboxUrl = '';
		activeTitle = '';
	}
</script>

<svelte:head><title>{activeTitle ? `${activeTitle} · ` : ''}Watch · Catalog</title></svelte:head>

{#if febboxUrl}
	<div class="player-page">
		<div class="player-bar">
			<button type="button" class="bar-btn" onclick={backToResults}>&larr; Back</button>
			<h1 class="player-title">{activeTitle}</h1>
			<a
				href="/entry/new?q={encodeURIComponent(activeTitle)}"
				class="bar-btn add-btn"
			>+ Add to library</a>
		</div>

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
	}
</style>
