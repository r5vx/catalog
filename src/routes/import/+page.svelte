<script lang="ts">
	import type { SearchResult } from '$lib/server/metadata/types';
	import { parseList } from '$lib/parseTitle';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Row = {
		line: string;
		options: SearchResult[];
		/** The chosen option's key, or 'skip'. */
		selected: string;
		categoryId: number | null;
		/** Where you left off, read from "(S1E23)" on the line. */
		season: number | null;
		episode: number | null;
	};

	let stage = $state<'paste' | 'matching' | 'review' | 'done'>('paste');
	let raw = $state('');
	let rows = $state<Row[]>([]);
	let progress = $state({ done: 0, total: 0 });
	let outcome = $state({ imported: 0, skipped: 0 });
	let importing = $state(false);

	const parsed = $derived(parseList(raw));
	const lineCount = $derived(parsed.length);

	async function findMatches() {
		const titles = parsed;
		if (titles.length === 0) return;

		stage = 'matching';
		rows = [];
		progress = { done: 0, total: titles.length };

		// Small batches, paced so the free APIs don't rate-limit us on a long list.
		const BATCH = 5;
		for (let i = 0; i < titles.length; i += BATCH) {
			const batch = titles.slice(i, i + BATCH);

			try {
				const response = await fetch('/api/match', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ titles: batch })
				});
				const payload = await response.json();

				for (const [offset, match] of (payload.matches ?? []).entries()) {
					rows.push({
						line: batch[offset]?.raw ?? match.title,
						options: match.options ?? [],
						selected: match.options?.[0]?.key ?? 'skip',
						categoryId: null,
						season: match.season ?? null,
						episode: match.episode ?? null
					});
				}
			} catch {
				for (const item of batch) {
					rows.push({
						line: item.raw,
						options: [],
						selected: 'skip',
						categoryId: null,
						season: item.season,
						episode: item.episode
					});
				}
			}

			progress.done = Math.min(titles.length, i + BATCH);

			if (i + BATCH < titles.length) {
				await new Promise((resolve) => setTimeout(resolve, 1100));
			}
		}

		stage = 'review';
	}

	/** Which row has its "search again" box open, and what's typed in it. */
	let editing = $state<number | null>(null);
	let retryText = $state('');
	let retrying = $state(false);

	function openRetry(index: number) {
		editing = index;
		retryText = rows[index].line;
	}

	/** Re-run one title with wording you've corrected. Fixes typos the databases can't. */
	async function retry(index: number) {
		if (retryText.trim().length < 2) return;
		retrying = true;
		try {
			const response = await fetch('/api/match', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ titles: [{ title: retryText.trim(), year: null }] })
			});
			const payload = await response.json();
			const options = payload.matches?.[0]?.options ?? [];

			rows[index].options = options;
			rows[index].selected = options[0]?.key ?? 'skip';
			rows[index].categoryId = null;
			if (options.length > 0) editing = null;
		} finally {
			retrying = false;
		}
	}

	function optionFor(row: Row): SearchResult | null {
		return row.options.find((option) => option.key === row.selected) ?? null;
	}

	function categoryFor(row: Row): number | null {
		if (row.categoryId) return row.categoryId;
		const option = optionFor(row);
		if (!option) return null;
		return data.categories.find((c) => c.slug === option.categorySlug)?.id ?? null;
	}

	const chosenCount = $derived(rows.filter((row) => row.selected !== 'skip').length);
	const unmatchedCount = $derived(rows.filter((row) => row.options.length === 0).length);

	async function runImport() {
		importing = true;
		try {
			const items = rows
				.filter((row) => row.selected !== 'skip')
				.map((row) => ({ result: optionFor(row), categoryId: categoryFor(row) }))
				.filter((item) => item.result);

			const response = await fetch('/api/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items })
			});

			outcome = await response.json();
			stage = 'done';
		} finally {
			importing = false;
		}
	}

	function startOver() {
		stage = 'paste';
		raw = '';
		rows = [];
	}
</script>

<svelte:head><title>Import a list · Catalog</title></svelte:head>

<header>
	<a href="/" class="back faint">&larr; Library</a>
	<h1>Import a list</h1>
</header>

{#if stage === 'paste'}
	<p class="muted intro">
		Paste your list straight out of Notes — one title per line. Bullets, numbering and
		blank lines are fine, they get cleaned up. Each title is looked up and you get to
		check every match before anything is saved.
	</p>

	{#if !data.tmdbEnabled}
		<p class="notice">
			<strong>Only anime will match right now.</strong> Movies and TV need a free TMDB key —
			see <code>README.md</code>.
		</p>
	{/if}

	<textarea
		id="list"
		class="paste"
		bind:value={raw}
		placeholder={'Darling in the Franxx\nSpirited Away\nBreaking Bad\nThe Grand Budapest Hotel'}
	></textarea>

	<div class="actions">
		<button type="button" class="btn btn-primary" disabled={lineCount === 0} onclick={findMatches}>
			Find matches
		</button>
		<span class="faint tabular count">
			{lineCount}
			{lineCount === 1 ? 'title' : 'titles'} detected
		</span>
	</div>
{:else if stage === 'matching'}
	<div class="working">
		<h2>Looking everything up…</h2>
		<p class="muted tabular">{progress.done} of {progress.total}</p>
		<div
			class="bar"
			role="progressbar"
			aria-valuenow={progress.done}
			aria-valuemin="0"
			aria-valuemax={progress.total}
		>
			<div class="fill" style:width="{(progress.done / progress.total) * 100}%"></div>
		</div>
		<p class="faint small">
			Paced deliberately so the free databases don't cut us off. A few hundred titles takes
			a couple of minutes.
		</p>
	</div>
{:else if stage === 'review'}
	<div class="summary">
		<p class="muted">
			<strong>{chosenCount}</strong> ready to import{#if unmatchedCount > 0}, <strong
				>{unmatchedCount}</strong
			> with no match{/if}. Change anything that looks wrong, then import.
		</p>
		<div class="actions">
			<button type="button" class="btn btn-primary" disabled={importing || chosenCount === 0} onclick={runImport}>
				{importing ? 'Importing…' : `Import ${chosenCount}`}
			</button>
			<button type="button" class="btn" onclick={startOver}>Start over</button>
		</div>
	</div>

	<ul class="rows">
		{#each rows as row, index (index)}
			{@const option = optionFor(row)}
			<li class="row" class:skipped={row.selected === 'skip'}>
				<div class="thumb">
					{#if option?.posterUrl}
						<img src={option.posterUrl} alt="" loading="lazy" />
					{:else}
						<span class="thumb-empty" aria-hidden="true">?</span>
					{/if}
				</div>

				<div class="from">
					<p class="original">{row.line}</p>
					{#if option}
						<p class="faint small tabular">
							&rarr; {option.title}{option.year ? ` (${option.year})` : ''} · {option.kind}
							{#if row.season !== null || row.episode !== null}
								· <span class="progress"
									>up to {row.season !== null ? `S${row.season}` : ''}{row.episode !== null
										? `E${row.episode}`
										: ''}</span
								>
							{/if}
						</p>
					{:else}
						<p class="faint small">No match.</p>
					{/if}

					{#if editing === index}
						<div class="retry">
							<input
								type="text"
								bind:value={retryText}
								aria-label="Corrected title for {row.line}"
								placeholder="Try different wording"
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										retry(index);
									}
								}}
							/>
							<button type="button" class="btn" disabled={retrying} onclick={() => retry(index)}>
								{retrying ? '…' : 'Search'}
							</button>
							<button type="button" class="btn" onclick={() => (editing = null)}>Close</button>
						</div>
					{:else if !option}
						<button type="button" class="linklike" onclick={() => openRetry(index)}>
							Fix the spelling
						</button>
					{:else}
						<button type="button" class="linklike on-hover" onclick={() => openRetry(index)}>
							Search again
						</button>
					{/if}
				</div>

				<div class="pick">
					<select aria-label="Match for {row.line}" bind:value={row.selected}>
						{#each row.options as opt (opt.key)}
							<option value={opt.key}>
								{opt.title}{opt.year ? ` (${opt.year})` : ''}
							</option>
						{/each}
						<option value="skip">— Skip this one —</option>
					</select>

					{#if option}
						<span class="cat-wrap">
							<select
								aria-label="Category for {row.line}{option.confident
									? ''
									: ' — close call, worth checking'}"
								class:unsure={!option.confident}
								value={String(categoryFor(row))}
								onchange={(e) => (row.categoryId = Number(e.currentTarget.value))}
							>
								{#each data.categories as category (category.id)}
									<option value={String(category.id)}>{category.emoji} {category.name}</option>
								{/each}
							</select>
							{#if !option.confident}
								<!-- A visible label, because a title tooltip on a <select> is
								     unreliable and simply never appeared. -->
								<span class="flag">close call</span>
							{/if}
						</span>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{:else}
	<div class="working">
		<h2>Imported</h2>
		<p class="muted">
			<strong class="tabular">{outcome.imported}</strong> added to your library{#if outcome.skipped > 0}, {outcome.skipped}
				already there{/if}.
		</p>
		<p class="faint small">
			Ratings and dates were left empty — these are things you watched at some point, and a
			made-up date is worse than none.
		</p>
		<div class="actions">
			<a href="/" class="btn btn-primary">See your library</a>
			<button type="button" class="btn" onclick={startOver}>Import another list</button>
		</div>
	</div>
{/if}

<style>
	header {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 18px;
	}

	.back {
		font-size: 0.85rem;
		width: fit-content;
	}
	.back:hover {
		color: var(--accent);
	}

	h1 {
		font-size: clamp(1.6rem, 4vw, 2.1rem);
	}

	h2 {
		font-size: 1.25rem;
	}

	.intro {
		font-size: 0.95rem;
		max-width: 62ch;
		margin: 0 0 18px;
	}

	.notice {
		background: var(--warn-bg);
		border: 1px solid var(--warn);
		color: var(--warn);
		border-radius: var(--radius-sm);
		padding: 10px 14px;
		margin: 0 0 18px;
		font-size: 0.88rem;
	}

	.notice code {
		font-family: var(--mono);
		font-size: 0.85em;
	}

	.paste {
		min-height: 300px;
		font-family: var(--mono);
		font-size: 0.88rem;
		line-height: 1.7;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
		margin-top: 16px;
	}

	.count,
	.small {
		font-size: 0.85rem;
	}

	.working {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
		padding: 40px 0;
		max-width: 56ch;
	}

	.bar {
		width: 100%;
		height: 6px;
		background: var(--sunk);
		border: 1px solid var(--rule);
		border-radius: 100px;
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.3s ease;
	}

	.summary {
		border-bottom: 1px solid var(--rule-firm);
		padding-bottom: 18px;
		margin-bottom: 4px;
	}

	.summary p {
		font-size: 0.93rem;
		margin: 0;
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.row {
		display: grid;
		grid-template-columns: 44px 1fr auto;
		gap: 14px;
		align-items: center;
		padding: 12px 0;
		border-bottom: 1px solid var(--rule);
	}

	.row.skipped {
		opacity: 0.45;
	}

	.thumb {
		aspect-ratio: 2 / 3;
		max-width: 100%;
		background: var(--surface-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		overflow: hidden;
		display: grid;
		place-items: center;
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.thumb-empty {
		color: var(--ink-faint);
		font-size: 0.85rem;
	}

	.from {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.original {
		font-size: 0.92rem;
		font-weight: 600;
		margin: 0;
		overflow-wrap: anywhere;
	}

	.from p {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.retry {
		display: flex;
		gap: 6px;
		margin-top: 6px;
	}

	.retry input {
		flex: 1;
		min-width: 0;
		font-size: 0.85rem;
		padding: 5px 8px;
	}

	.retry .btn {
		padding: 5px 10px;
		font-size: 0.82rem;
	}

	.progress {
		color: var(--accent);
		font-weight: 600;
	}

	/* Hidden until you point at the row, so the list isn't a wall of links. */
	.on-hover {
		opacity: 0;
		transition: opacity 0.12s ease;
	}

	.row:hover .on-hover,
	.on-hover:focus-visible {
		opacity: 1;
	}

	.cat-wrap {
		display: inline-flex;
		flex-direction: column;
		gap: 2px;
	}

	.flag {
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--warn);
		text-align: center;
	}

	.linklike {
		align-self: flex-start;
		background: none;
		border: none;
		padding: 2px 0 0;
		font-size: 0.78rem;
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}

	.pick {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.pick select {
		width: auto;
		max-width: 230px;
		font-size: 0.83rem;
		padding: 6px 8px;
	}

	.pick select.unsure {
		border-color: var(--warn);
	}

	@media (max-width: 720px) {
		.row {
			grid-template-columns: 40px 1fr;
			row-gap: 9px;
		}
		.pick {
			grid-column: 2 / 3;
			flex-wrap: wrap;
		}
		.pick select {
			flex: 1;
			min-width: 0;
			max-width: none;
		}
	}
</style>
