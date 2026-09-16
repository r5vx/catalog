<script lang="ts">
	import { statusLabel } from '$lib/constants';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type SharedTitle = {
		title: string;
		year: number | null;
		category: string;
		status: string;
		posterUrl: string | null;
		externalRating: number | null;
		imdbRating: number | null;
		rtScore: number | null;
		metascore: number | null;
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

	/* ------------------------------------------------------------ filtering */

	const normalise = (t: string) =>
		t
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, ' ')
			.trim();

	const mine = $derived(new Set(data.yours));

	let search = $state('');
	let category = $state('');
	let onlyNew = $state(false);

	const categories = $derived([...new Set(share?.titles.map((t) => t.category) ?? [])]);

	const rows = $derived.by(() => {
		const all = (share?.titles ?? []).map((title) => ({
			...title,
			owned: mine.has(normalise(title.title))
		}));

		const needle = search.trim().toLowerCase();

		return all.filter(
			(row) =>
				(!category || row.category === category) &&
				(!onlyNew || !row.owned) &&
				(!needle || row.title.toLowerCase().includes(needle))
		);
	});

	const overlap = $derived(
		(share?.titles ?? []).filter((t) => mine.has(normalise(t.title))).length
	);

	const sharedOn = $derived(
		share ? new Date(share.sharedAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) : ''
	);
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

	<div class="toolbar">
		<input type="search" placeholder="Search their titles…" bind:value={search} />

		<select bind:value={category} aria-label="Category">
			<option value="">Everything</option>
			{#each categories as one (one)}
				<option value={one}>{one}</option>
			{/each}
		</select>

		<label class="toggle">
			<input type="checkbox" bind:checked={onlyNew} />
			Only what I haven't seen
		</label>
	</div>

	{#if rows.length === 0}
		<p class="empty muted">Nothing matches.</p>
	{:else}
		<ul class="grid">
			{#each rows as row, index (row.title + (row.year ?? '') + index)}
				<li class:owned={row.owned}>
					<div class="poster">
						{#if row.posterUrl}
							<img src={row.posterUrl} alt="" loading="lazy" />
						{:else}
							<span class="fallback" aria-hidden="true">?</span>
						{/if}
						{#if row.owned}<span class="seen" title="In your library">✓</span>{/if}
					</div>

					<h2 class="name">{row.title}</h2>
					<p class="sub faint tabular">
						<!-- &nbsp; because Svelte trims a leading space in this text node. -->
						{row.year ?? '—'}{#if row.status !== 'completed'}&nbsp;· {statusLabel(row.status)}{/if}
					</p>

					<p class="scores tabular">
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
		border-radius: var(--radius-sm);
		padding: 9px 13px;
		margin: 0;
		font-size: 0.89rem;
	}

	.bad {
		background: var(--accent-bg);
		border: 1px solid var(--accent);
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

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 0.88rem;
		color: var(--ink-soft);
		white-space: nowrap;
		cursor: pointer;
	}

	.toggle input {
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

	.poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	/* What they've seen and you haven't is the point, so the rest recedes. */
	.owned .poster {
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

	.empty {
		margin-top: 30px;
	}
</style>
