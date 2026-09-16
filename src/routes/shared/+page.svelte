<script lang="ts">
	import { statusLabel, sortBadge } from '$lib/constants';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type SharedTitle = {
		title: string;
		year: number | null;
		category: string;
		status: string;
		posterUrl: string | null;
		externalRating: number | null;
		externalVotes?: number | null;
		imdbRating: number | null;
		rtScore: number | null;
		metascore: number | null;
		runtimeMinutes?: number | null;
		boxOffice?: number | null;
		/** Only in files shared by a newer Catalog — what makes a title clickable. */
		source?: string;
		sourceId?: string;
		tags: string[];
		rating?: number | null;
		favorite?: boolean;
		notes?: string;
	};

	type Share = {
		catalogShare: number;
		sharedAt: string;
		from: string | null;
		includes: { ratings: boolean; notes: boolean };
		titles: SharedTitle[];
	};

	const STORE = 'catalog.sharedLibrary';

	let share = $state<Share | null>(null);
	let problem = $state('');

	// Kept for the session so clicking into a title and back doesn't lose it.
	$effect(() => {
		if (share) return;
		try {
			const saved = sessionStorage.getItem(STORE);
			if (saved) share = JSON.parse(saved);
		} catch {
			// Private window, or something stale. Start from the file picker.
		}
	});

	function open(file: File) {
		problem = '';

		const reader = new FileReader();

		reader.onerror = () => (problem = 'That file could not be read.');

		reader.onload = () => {
			try {
				const parsed = JSON.parse(String(reader.result));

				if (!parsed?.catalogShare || !Array.isArray(parsed.titles)) {
					problem =
						'That is not a shared library. Ask them for the file from Settings → Library → Share.';
					return;
				}

				share = parsed;
				try {
					sessionStorage.setItem(STORE, JSON.stringify(parsed));
				} catch {
					// Too big for session storage, or blocked. It still works now.
				}
			} catch {
				problem = 'That file is not readable JSON.';
			}
		};

		reader.readAsText(file);
	}

	function close() {
		share = null;
		problem = '';
		try {
			sessionStorage.removeItem(STORE);
		} catch {
			// Nothing to clear.
		}
	}

	/* ------------------------------------------------ what you both have seen */

	const normalise = (t: string) =>
		t
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, ' ')
			.trim();

	const myTitles = $derived(new Set(data.yours));
	const myKeys = $derived(new Set(data.yourKeys));

	/** Added from this page during this visit, so the mark updates as you go. */
	let justAdded = $state<Record<string, number>>({});
	let busy = $state<string | null>(null);
	let trouble = $state('');

	const keyOf = (row: SharedTitle) =>
		row.source && row.sourceId ? `${row.source}:${row.sourceId}` : `title:${normalise(row.title)}`;

	/**
	 * Whether you've seen it too.
	 *
	 * By the database's id where the file carries one, since that's exact.
	 * Older files have only names, and a name match with the year is as close
	 * as those can get.
	 */
	function isMine(row: SharedTitle): boolean {
		if (keyOf(row) in justAdded) return true;
		if (row.source && row.sourceId && myKeys.has(`${row.source}:${row.sourceId}`)) return true;

		const name = normalise(row.title);
		return myTitles.has(row.year ? `${name}|${row.year}` : name) || myTitles.has(name);
	}

	async function add(row: SharedTitle, status: string) {
		if (!row.source || !row.sourceId) return;

		busy = keyOf(row);
		trouble = '';

		try {
			const response = await fetch('/api/add', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ source: row.source, sourceId: row.sourceId, status })
			});

			if (!response.ok) {
				trouble = 'That could not be added. Try again in a moment.';
				return;
			}

			const added = await response.json();
			justAdded = { ...justAdded, [keyOf(row)]: added.id };
		} catch {
			trouble = 'That could not be added — no connection.';
		} finally {
			busy = null;
		}
	}

	const link = (row: SharedTitle) =>
		row.source && row.sourceId
			? `/title/${row.source}/${encodeURIComponent(row.sourceId)}?back=${encodeURIComponent('/shared')}`
			: null;

	/* ------------------------------------------------------- filter and sort */

	/**
	 * The sorts that make sense for a list that isn't yours.
	 *
	 * Deliberately the same names the library uses, so the badge under each
	 * card — the value you sorted on — comes out identically here.
	 */
	const SORTS = [
		{ value: 'title', label: 'Title (A–Z)' },
		{ value: 'year', label: 'Newest release' },
		{ value: 'oldest', label: 'Oldest release' },
		{ value: 'rating', label: 'Their rating' },
		{ value: 'public', label: 'TMDB / AniList' },
		{ value: 'imdb', label: 'IMDb rating' },
		{ value: 'rt', label: 'Rotten Tomatoes' },
		{ value: 'metacritic', label: 'Metacritic' },
		{ value: 'votes', label: 'Most voted on' },
		{ value: 'runtime', label: 'Longest' },
		{ value: 'box', label: 'Box office' }
	];

	const SHOW = [
		{ value: '', label: 'Everything' },
		{ value: 'new', label: "Only what I haven't seen" },
		{ value: 'both', label: "Only what we've both seen" }
	];

	let search = $state('');
	let category = $state('');
	let show = $state('');
	let sort = $state('title');

	const categories = $derived([...new Set(share?.titles.map((t) => t.category) ?? [])]);

	/** The number a sort orders on, or null where this title hasn't got one. */
	function value(row: SharedTitle, by: string): number | null {
		switch (by) {
			case 'year':
			case 'oldest':
				return row.year ?? null;
			case 'rating':
				return row.rating ?? null;
			case 'public':
				return row.externalRating ?? null;
			case 'imdb':
				return row.imdbRating ?? null;
			case 'rt':
				return row.rtScore ?? null;
			case 'metacritic':
				return row.metascore ?? null;
			case 'votes':
				return row.externalVotes ?? null;
			case 'runtime':
				return row.runtimeMinutes ?? null;
			case 'box':
				return row.boxOffice ?? null;
			default:
				return null;
		}
	}

	const rows = $derived.by(() => {
		const needle = search.trim().toLowerCase();

		const kept = (share?.titles ?? [])
			.map((title) => ({ ...title, owned: isMine(title) }))
			.filter(
				(row) =>
					(!category || row.category === category) &&
					(show !== 'new' || !row.owned) &&
					(show !== 'both' || row.owned) &&
					(!needle || row.title.toLowerCase().includes(needle))
			);

		if (sort === 'title') return kept.sort((a, b) => a.title.localeCompare(b.title));

		const ascending = sort === 'oldest';

		// Titles with no value sit at the bottom whichever way round it is —
		// "longest" shouldn't open with everything nobody has a runtime for.
		return kept.sort((a, b) => {
			const left = value(a, sort);
			const right = value(b, sort);

			if (left == null && right == null) return a.title.localeCompare(b.title);
			if (left == null) return 1;
			if (right == null) return -1;
			if (left === right) return a.title.localeCompare(b.title);

			return ascending ? left - right : right - left;
		});
	});

	const overlap = $derived((share?.titles ?? []).filter((t) => isMine(t)).length);

	const sharedOn = $derived(
		share ? new Date(share.sharedAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) : ''
	);

	/** Older share files have no ids, so nothing in them can be opened or added. */
	const clickable = $derived((share?.titles ?? []).some((t) => t.source && t.sourceId));
</script>

<svelte:head><title>A shared library · Catalog</title></svelte:head>

<a href="/" class="back faint">&larr; Library</a>

{#if !share}
	<div class="opener">
		<h1>Open someone's catalog</h1>
		<p class="muted">
			They export it from <strong>Settings → Library → Share</strong> and send you the file.
		</p>

		{#if problem}
			<p class="msg bad" role="alert">{problem}</p>
		{/if}

		<label class="drop">
			<input
				type="file"
				accept="application/json,.json"
				onchange={(e) => {
					const file = e.currentTarget.files?.[0];
					if (file) open(file);
				}}
			/>
			<span class="drop-label">Choose a file</span>
		</label>

		<p class="faint hint">It stays on this computer — nothing is uploaded or saved.</p>
	</div>
{:else}
	<header>
		<div class="title-row">
			<h1>{share.from ? `${share.from}'s catalog` : 'A shared catalog'}</h1>
			<button type="button" class="btn" onclick={close}>Close</button>
		</div>
		<p class="muted tabular">
			{share.titles.length} titles · {overlap} you've also seen · shared {sharedOn}
		</p>
	</header>

	{#if trouble}
		<p class="msg bad" role="alert">{trouble}</p>
	{/if}

	{#if !clickable}
		<p class="msg" role="status">
			This file was shared by an older Catalog, so its titles can't be opened or added. A new
			one from them will work.
		</p>
	{/if}

	<div class="toolbar">
		<input type="search" placeholder="Search their titles…" bind:value={search} />

		<select bind:value={category} aria-label="Category">
			<option value="">Every category</option>
			{#each categories as one (one)}
				<option value={one}>{one}</option>
			{/each}
		</select>

		<select bind:value={show} aria-label="Which titles">
			{#each SHOW as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>

		<select bind:value={sort} aria-label="Sort by">
			{#each SORTS as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
	</div>

	{#if rows.length === 0}
		<p class="empty muted">Nothing matches.</p>
	{:else}
		<ul class="grid">
			{#each rows as row, index (keyOf(row) + index)}
				<li class:owned={row.owned}>
					{#if link(row)}
						<a class="poster" href={link(row)} title="Read about {row.title}">
							{#if row.posterUrl}
								<img src={row.posterUrl} alt="" loading="lazy" />
							{:else}
								<span class="fallback" aria-hidden="true">?</span>
							{/if}
							{#if row.owned}<span class="seen" title="In your library">&check;</span>{/if}
						</a>
					{:else}
						<div class="poster">
							{#if row.posterUrl}
								<img src={row.posterUrl} alt="" loading="lazy" />
							{:else}
								<span class="fallback" aria-hidden="true">?</span>
							{/if}
							{#if row.owned}<span class="seen" title="In your library">&check;</span>{/if}
						</div>
					{/if}

					{#if link(row)}
						<a href={link(row)} class="name">{row.title}</a>
					{:else}
						<h2 class="name">{row.title}</h2>
					{/if}

					<p class="sub faint tabular">
						<!-- &nbsp; because Svelte trims a leading space in this text node. -->
						{row.year ?? '—'}{#if row.status !== 'completed'}&nbsp;· {statusLabel(row.status)}{/if}
					</p>

					<p class="scores tabular">
						{#if sortBadge(row, sort)}
							<span class="sorted">{sortBadge(row, sort)}</span>
						{/if}
						{#if row.rating != null}
							<span class="theirs" title="Their rating">{row.rating}/10</span>
						{/if}
						{#if row.imdbRating != null}
							<span class="faint">IMDb {row.imdbRating.toFixed(1)}</span>
						{:else if row.externalRating != null}
							<span class="faint">{row.externalRating.toFixed(1)}</span>
						{/if}
						{#if row.favorite}<span class="star" title="A favourite of theirs">★</span>{/if}
					</p>

					{#if row.notes}
						<p class="note">{row.notes}</p>
					{/if}

					{#if justAdded[keyOf(row)]}
						<a class="added" href="/entry/{justAdded[keyOf(row)]}">Added &rarr;</a>
					{:else if row.owned}
						<span class="added faint">Already yours</span>
					{:else if row.source && row.sourceId}
						<div class="actions">
							<button
								type="button"
								class="btn tiny"
								disabled={busy === keyOf(row)}
								onclick={() => add(row, 'planned')}
							>
								Watchlist
							</button>
							<button
								type="button"
								class="btn tiny"
								disabled={busy === keyOf(row)}
								onclick={() => add(row, 'completed')}
							>
								Seen it
							</button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<style>
	.back {
		font-size: 0.85rem;
		display: inline-block;
		margin-bottom: 14px;
	}

	.back:hover {
		color: var(--accent);
	}

	/* --------------------------------------------------------- the opener */

	.opener {
		max-width: 46ch;
		margin: 8vh auto 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: flex-start;
	}

	.opener h1 {
		font-size: clamp(1.6rem, 4vw, 2.1rem);
	}

	.muted {
		margin: 0;
		font-size: 0.93rem;
	}

	.drop {
		width: 100%;
		border: 1px dashed var(--rule-firm);
		border-radius: var(--radius);
		padding: 26px;
		text-align: center;
		cursor: pointer;
		background: var(--surface);
		transition: border-color 0.14s ease;
	}

	.drop:hover {
		border-color: var(--accent);
	}

	.drop input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}

	.drop-label {
		font-weight: 600;
		color: var(--accent);
	}

	.msg {
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius-sm);
		padding: 9px 13px;
		margin: 0 0 16px;
		font-size: 0.89rem;
		background: var(--surface);
	}

	.bad {
		background: var(--accent-bg);
		border-color: var(--accent);
		color: var(--accent);
	}

	.hint {
		font-size: 0.8rem;
		margin: 0;
	}

	/* -------------------------------------------------------- the library */

	header {
		margin-bottom: 20px;
	}

	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		flex-wrap: wrap;
	}

	h1 {
		font-size: clamp(1.5rem, 4vw, 2rem);
	}

	header .muted {
		margin-top: 3px;
		font-size: 0.88rem;
	}

	.toolbar {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		align-items: center;
		margin-bottom: 22px;
	}

	.toolbar input[type='search'] {
		flex: 1;
		min-width: 180px;
	}

	.toolbar select {
		width: auto;
	}

	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 22px 16px;
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
		margin-bottom: 7px;
	}

	a.poster:hover {
		border-color: var(--accent);
	}

	.poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	/* What they've seen and you haven't is the point, so the rest recedes. */
	.owned .poster img {
		opacity: 0.45;
	}

	.fallback {
		font-size: 1.8rem;
		opacity: 0.4;
	}

	.seen {
		position: absolute;
		top: 6px;
		right: 6px;
		background: var(--good);
		color: var(--paper);
		width: 22px;
		height: 22px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-size: 0.75rem;
		font-weight: 700;
	}

	.name {
		font-family: var(--body);
		font-size: 0.9rem;
		font-weight: 600;
		line-height: 1.3;
		margin: 0;
		overflow-wrap: anywhere;
		display: block;
	}

	a.name:hover {
		color: var(--accent);
	}

	.sub,
	.scores {
		font-size: 0.78rem;
		margin: 2px 0 0;
	}

	.scores {
		display: flex;
		gap: 8px;
		align-items: baseline;
		flex-wrap: wrap;
	}

	/* The value you sorted on, the same way the library shows it. */
	.sorted {
		color: var(--ink);
		font-weight: 600;
	}

	.theirs {
		color: var(--accent);
		font-weight: 600;
	}

	.star {
		color: var(--accent);
	}

	.note {
		font-size: 0.78rem;
		line-height: 1.5;
		color: var(--ink-soft);
		margin: 5px 0 0;
		padding-left: 8px;
		border-left: 2px solid var(--rule-firm);
		white-space: pre-wrap;
	}

	.actions {
		display: flex;
		gap: 6px;
		margin-top: 8px;
	}

	.tiny {
		font-size: 0.74rem;
		padding: 4px 9px;
	}

	.added {
		display: inline-block;
		margin-top: 8px;
		font-size: 0.76rem;
		font-weight: 600;
		color: var(--good);
	}

	.empty {
		margin-top: 30px;
	}
</style>
