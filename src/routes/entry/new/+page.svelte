<script lang="ts">
	/**
	 * Adding to the library: search, with results as posters, and the other ways in below it (a list
	 * from another site, a pasted list, by hand). Rebuilt 2026-11-20 (owner: "revamp the add page
	 * cause its really old").
	 */
	import { page } from '$app/state';
	import { onDestroy, onMount } from 'svelte';
	import { p } from '$lib/altText';
	import type { SearchResult } from '$lib/server/metadata/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const pm = $derived(page.data.altMode);
	// ("alt:…" and "#2" only pick the wording when the code is on: src/lib/altText.ts.)
	const t = (text: string) => (pm ? p(text) : text.replace(/^alt:/, '').replace(/#\d+$/, ''));

	let query = $state('');
	let results = $state<SearchResult[]>([]);
	let loading = $state(false);
	let searched = $state(false);
	let problem = $state('');

	/** key -> the id of the entry made, so the card can say Added. */
	let added = $state<Record<string, number>>({});
	/** key -> a category picked instead of the guessed one. */
	let chosen = $state<Record<string, number>>({});
	let busy = $state<string | null>(null);

	let timer: ReturnType<typeof setTimeout>;
	let sequence = 0;
	let box = $state<HTMLInputElement | null>(null);

	onMount(() => {
		const q = page.url.searchParams.get('q');
		if (q && q.trim().length >= 2) {
			query = q;
			loading = true;
			runSearch();
		}
		box?.focus();
	});
	onDestroy(() => {
		sequence++;
		clearTimeout(timer);
	});

	function onInput() {
		sequence++;
		clearTimeout(timer);
		if (query.trim().length < 2) {
			results = [];
			searched = false;
			loading = false;
			problem = '';
			return;
		}
		loading = true;
		timer = setTimeout(runSearch, 280);
	}

	async function runSearch() {
		const mine = ++sequence;
		try {
			const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { headers: { Accept: 'application/json' } });
			// A PIN-locked app answers an expired session with the sign-in page, not results.
			if (response.redirected || !response.headers.get('content-type')?.includes('json')) {
				if (mine === sequence) {
					results = [];
					problem = 'Your session expired. Reload this page and enter your PIN again.';
				}
				return;
			}
			const payload = await response.json();
			if (mine !== sequence) return;
			results = payload.results ?? [];
			problem = '';
		} catch {
			if (mine === sequence) {
				results = [];
				problem = 'Could not reach the search service. Check your internet connection.';
			}
		} finally {
			if (mine === sequence) {
				loading = false;
				searched = true;
			}
		}
	}

	function categoryIdFor(result: SearchResult): number {
		if (chosen[result.key]) return chosen[result.key];
		return data.categories.find((c) => c.slug === result.categorySlug)?.id ?? data.categories[0]?.id;
	}

	async function add(result: SearchResult) {
		busy = result.key;
		try {
			const response = await fetch('/api/entries', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ result, categoryId: categoryIdFor(result), markWatchedToday: true })
			});
			const payload = await response.json();
			added[result.key] = payload.id;
		} finally {
			busy = null;
		}
	}

	const addedCount = $derived(Object.keys(added).length);
</script>

<svelte:head><title>{t('alt:Add to your library')} · {t('alt:Catalog#2')}</title></svelte:head>

<a href="/?library=1" class="back faint">&larr; {t('Library')}</a>

<section class="hero">
	<h1>{t('alt:Add to your library')}</h1>
	<label class="search">
		<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
			<circle cx="11" cy="11" r="7" />
			<path d="M20 20l-3.5-3.5" />
		</svg>
		<input
			bind:this={box}
			type="search"
			placeholder={t('alt:Start typing a title…')}
			autocomplete="off"
			bind:value={query}
			oninput={onInput}
			aria-label="Search for something to add"
		/>
		{#if loading}<span class="spinner" aria-hidden="true"></span>{/if}
	</label>
	<p class="faint hint" aria-live="polite">
		{#if addedCount > 0}
			{addedCount} added. <a href="/?library=1" class="link">Back to the library</a>
		{:else if searched && !loading && results.length === 0 && !problem}
			Nothing found for that.
		{:else}
			Films, shows and anime. The poster, year and kind fill in by themselves.
		{/if}
	</p>
</section>

{#if !data.tmdbEnabled}
	<p class="notice">Films and shows need a free TMDB key: <a href="/settings/services">Settings → Services</a>.</p>
{/if}
{#if problem}
	<p class="notice problem" role="alert">{problem}</p>
{/if}

{#if results.length}
	<ul class="results">
		{#each results as result (result.key)}
			{@const isAdded = added[result.key] !== undefined}
			<li class="card" class:is-added={isAdded}>
				<div class="poster">
					{#if result.posterUrl}
						<img src={result.posterUrl} alt="" loading="lazy" />
					{:else}
						<span class="no-poster">{result.title}</span>
					{/if}
					{#if isAdded}
						<span class="added-mark">
							<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
						</span>
					{/if}
				</div>
				<div class="body">
					<h2 title={result.title}>{result.title}</h2>
					<p class="faint facts tabular">{result.year ?? '—'} · {result.kind}{result.episodesTotal ? ` · ${result.episodesTotal} eps` : ''}</p>
					{#if isAdded}
						<a href="/entry/{added[result.key]}" class="btn small-btn">{t('Open')}</a>
					{:else}
						<select
							class="category"
							class:unsure={!result.confident}
							aria-label="Where {result.title} goes"
							title={result.confident ? '' : 'A guess: worth checking'}
							value={String(categoryIdFor(result))}
							onchange={(e) => (chosen[result.key] = Number(e.currentTarget.value))}
						>
							{#each data.categories as category (category.id)}
								<option value={String(category.id)}>{category.name}</option>
							{/each}
						</select>
						<button type="button" class="btn btn-primary small-btn" disabled={busy === result.key} onclick={() => add(result)}>
							{busy === result.key ? t('alt:Adding…') : t('alt:Add')}
						</button>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{/if}

{#if !results.length}
	<section class="ways">
		<h2 class="ways-title">Other ways to add</h2>
		<div class="way-grid">
			<a class="way" href="/import/list">
				<span class="way-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 19h16" /></svg>
				</span>
				<strong>Import from another site</strong>
				<span class="faint">Everything you've watched, from MyAnimeList, AniList, Kitsu, Letterboxd or IMDb</span>
			</a>
			<a class="way" href="/import">
				<span class="way-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>
				</span>
				<strong>Paste a list</strong>
				<span class="faint">One title a line, from notes or anywhere else</span>
			</a>
			<a class="way" href="/entry/manual">
				<span class="way-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>
				</span>
				<strong>Add by hand</strong>
				<span class="faint">For something no database has</span>
			</a>
		</div>
	</section>
{/if}

<style>
	.back {
		display: inline-block;
		font-size: 0.85rem;
		margin-bottom: 14px;
	}

	.back:hover {
		color: var(--accent);
	}

	.hero {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-bottom: 22px;
	}

	h1 {
		font-size: clamp(1.6rem, 4vw, 2.2rem);
	}

	.search {
		position: relative;
		display: flex;
		align-items: center;
		max-width: 720px;
		color: var(--ink-faint);
	}

	.search svg {
		position: absolute;
		left: 16px;
		pointer-events: none;
	}

	.search input {
		width: 100%;
		padding: 15px 48px 15px 48px;
		font-size: 1.1rem;
		border-radius: 12px;
		background: var(--surface);
		box-shadow: var(--shadow);
	}

	.spinner {
		position: absolute;
		right: 16px;
		width: 18px;
		height: 18px;
		border: 2px solid var(--rule);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.hint {
		margin: 0;
		font-size: 0.88rem;
	}

	.link {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.notice {
		max-width: 720px;
		background: var(--warn-bg);
		border: 1px solid var(--warn);
		color: var(--warn);
		border-radius: var(--radius);
		padding: 10px 14px;
		margin: 0 0 16px;
		font-size: 0.88rem;
	}

	.notice a {
		color: inherit;
		text-decoration: underline;
	}

	.problem {
		background: var(--accent-bg);
		border-color: var(--accent);
		color: var(--ink);
	}

	/* Results: posters, as on Browse. */
	.results {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 18px;
	}

	.card {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--rule);
		border-radius: 10px;
		background: var(--surface);
		overflow: hidden;
		transition: opacity 0.2s;
	}

	.card.is-added {
		opacity: 0.75;
	}

	.poster {
		position: relative;
		aspect-ratio: 2 / 3;
		background: var(--surface-2);
	}

	.poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.no-poster {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 12px;
		text-align: center;
		color: var(--ink-faint);
		font-size: 0.85rem;
	}

	.added-mark {
		position: absolute;
		top: 8px;
		right: 8px;
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: var(--good);
		color: var(--paper);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px 10px 12px;
	}

	.body h2 {
		margin: 0;
		font-family: var(--body);
		font-size: 0.92rem;
		font-weight: 600;
		line-height: 1.25;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.facts {
		margin: 0;
		font-size: 0.78rem;
	}

	.category {
		width: 100%;
		font-size: 0.82rem;
		padding: 5px 8px;
	}

	.category.unsure {
		border-color: var(--warn);
	}

	.small-btn {
		width: 100%;
		justify-content: center;
		text-align: center;
	}

	/* The other ways in. */
	.ways {
		margin-top: 8px;
	}

	.ways-title {
		font-family: var(--body);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin: 0 0 12px;
	}

	.way-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 14px;
		max-width: 900px;
	}

	.way {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 18px;
		border: 1px solid var(--rule);
		border-radius: 12px;
		background: var(--surface);
		color: inherit;
		text-decoration: none;
		transition: border-color 0.15s, transform 0.15s;
	}

	.way:hover {
		border-color: var(--accent);
		transform: translateY(-2px);
	}

	.way-icon {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		margin-bottom: 4px;
		border-radius: 10px;
		background: var(--accent-bg);
		color: var(--accent);
	}

	.way .faint {
		font-size: 0.85rem;
		line-height: 1.4;
	}

	@media (max-width: 520px) {
		.results {
			grid-template-columns: repeat(2, 1fr);
			gap: 12px;
		}
	}
</style>
