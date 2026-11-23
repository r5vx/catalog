<script lang="ts">
	/**
	 * Import from another site (src/lib/server/listImport.ts): pick the site, give the username (or
	 * the export file), and everything on that list is matched and shown to check before it's added,
	 * with its status, score and where you got to. A show's seasons come in as one entry.
	 */
	import { page } from '$app/state';
	import { STATUSES } from '$lib/constants';
	import { groupMatches, type ImportRow, type ListItem, type ListSite } from '$lib/listImport';
	import type { SearchResult } from '$lib/server/metadata/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const stars = $derived((page.data.ratingStars as number | undefined) ?? 5);

	type Site = { id: ListSite; name: string; by: 'user' | 'file'; what: string; help: string };
	const SITES: Site[] = [
		{ id: 'mal', name: 'MyAnimeList', by: 'user', what: 'Anime', help: 'Your username on MyAnimeList. The list needs to be public (it is unless you changed it).' },
		{ id: 'anilist', name: 'AniList', by: 'user', what: 'Anime', help: 'Your username on AniList. The list needs to be public.' },
		{ id: 'kitsu', name: 'Kitsu', by: 'user', what: 'Anime', help: 'Your username on Kitsu.' },
		{ id: 'letterboxd', name: 'Letterboxd', by: 'file', what: 'Films', help: "On Letterboxd: Settings → Import & Export → Export your data. Open the file it gives you and pick ratings.csv (or watched.csv for everything, rated or not)." },
		{ id: 'imdb', name: 'IMDb', by: 'file', what: 'Films and shows', help: 'On IMDb: Your ratings → the three dots → Export. Pick the file it gives you.' }
	];

	let site = $state<Site | null>(null);
	let user = $state('');
	let fileText = $state('');
	let fileName = $state('');
	let stage = $state<'pick' | 'loading' | 'matching' | 'review' | 'adding' | 'done'>('pick');
	let problem = $state('');
	let progress = $state({ done: 0, total: 0 });

	type Row = ImportRow & { selected: string; include: boolean; have: boolean };
	let rows = $state<Row[]>([]);
	let unmatched = $state<string[]>([]);
	let have = new Set<string>();
	let tab = $state<'add' | 'have' | 'none'>('add');
	let outcome = $state({ imported: 0, skipped: 0 });

	function pickSite(next: Site) {
		site = next;
		problem = '';
		user = '';
		fileText = '';
		fileName = '';
	}

	async function chooseFile(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		fileName = file.name;
		fileText = await file.text();
	}

	async function start(event: SubmitEvent) {
		event.preventDefault();
		if (!site) return;
		problem = '';
		stage = 'loading';
		const answer = await fetch('/api/import/list', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ site: site.id, user, file: fileText })
		})
			.then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => null) }))
			.catch(() => null);
		if (!answer?.ok) {
			problem = answer?.data?.error ?? "The list couldn't be read.";
			stage = 'pick';
			return;
		}
		await match(answer.data.items as ListItem[]);
	}

	/** Twenty at a time, so the bar moves; then a show's seasons are brought together. */
	async function match(items: ListItem[]) {
		stage = 'matching';
		progress = { done: 0, total: items.length };
		const matched: { item: ListItem; options: SearchResult[] }[] = [];
		have = new Set();
		for (let i = 0; i < items.length; i += 20) {
			const answer = await fetch('/api/import/match-list', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items: items.slice(i, i + 20) })
			})
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null);
			for (const m of answer?.matched ?? []) matched.push(m);
			for (const key of answer?.have ?? []) have.add(key);
			progress = { done: Math.min(items.length, i + 20), total: items.length };
		}
		unmatched = matched.filter((m) => !m.options.length).map((m) => m.item.title);
		rows = groupMatches(matched).map((row) => {
			const inLibrary = have.has(row.options[0].key);
			return { ...row, selected: row.options[0].key, include: !inLibrary, have: inLibrary };
		});
		tab = 'add';
		stage = 'review';
	}

	const optionOf = (row: Row) => row.options.find((o) => o.key === row.selected) ?? row.options[0];
	const toAdd = $derived(rows.filter((r) => !r.have));
	const inLibrary = $derived(rows.filter((r) => r.have));
	const picked = $derived(toAdd.filter((r) => r.include).length);
	const shown = $derived(tab === 'add' ? toAdd : inLibrary);
	const statusLabel = (value: string) => STATUSES.find((s) => s.value === value)?.label ?? value;
	const rated = (rating: number | null) => (rating === null ? '' : stars === 10 ? `${rating}/10` : `${rating / 2}/5`);

	async function addAll() {
		stage = 'adding';
		const items = toAdd
			.filter((r) => r.include)
			.map((r) => {
				const result = optionOf(r);
				return {
					result,
					categoryId: data.categories.find((c) => c.slug === result.categorySlug)?.id ?? null,
					status: r.status,
					rating: r.rating,
					lastSeason: r.lastSeason,
					lastEpisode: r.lastEpisode
				};
			});
		const answer = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) })
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		if (!answer) {
			problem = "They couldn't be added. Try again.";
			stage = 'review';
			return;
		}
		outcome = { imported: answer.imported ?? 0, skipped: (answer.skipped ?? 0) + inLibrary.length };
		stage = 'done';
	}

	function again() {
		stage = 'pick';
		rows = [];
		unmatched = [];
		problem = '';
	}
</script>

<svelte:head><title>Import from another site · Catalog</title></svelte:head>

<a href="/entry/new" class="back faint">&larr; Add</a>
<h1>Import from another site</h1>

{#if !data.tmdbEnabled}
	<p class="notice">Importing needs a free TMDB key: <a href="/settings/services">Settings → Services</a>.</p>
{/if}

{#if stage === 'pick' || stage === 'loading'}
	<p class="muted lede">Everything you've marked on another site comes into your library: what you finished, what you're watching, what you want to watch, and your scores.</p>
	<div class="sites" role="radiogroup" aria-label="Which site">
		{#each SITES as s (s.id)}
			<button type="button" class="site" class:on={site?.id === s.id} role="radio" aria-checked={site?.id === s.id} onclick={() => pickSite(s)}>
				<strong>{s.name}</strong>
				<span class="faint">{s.what} · {s.by === 'user' ? 'username' : 'export file'}</span>
			</button>
		{/each}
	</div>

	{#if site}
		<form class="give" onsubmit={start}>
			<p class="faint help">{site.help}</p>
			{#if site.by === 'user'}
				<div class="row">
					<!-- svelte-ignore a11y_autofocus -->
					<input type="text" bind:value={user} placeholder="Username" autocomplete="off" autofocus aria-label="Your username on {site.name}" />
					<button type="submit" class="btn btn-primary" disabled={!user.trim() || stage === 'loading'}>{stage === 'loading' ? 'Loading…' : 'Load my list'}</button>
				</div>
			{:else}
				<div class="row">
					<label class="btn">
						{fileName ? 'Change file' : 'Choose file'}
						<input type="file" accept=".csv,text/csv" hidden onchange={chooseFile} />
					</label>
					{#if fileName}<span class="faint file">{fileName}</span>{/if}
					<button type="submit" class="btn btn-primary" disabled={!fileText || stage === 'loading'}>{stage === 'loading' ? 'Reading…' : 'Read the file'}</button>
				</div>
			{/if}
			{#if problem}<p class="msg bad" role="alert">{problem}</p>{/if}
		</form>
	{/if}
{:else if stage === 'matching'}
	<div class="matching">
		<p>Finding each title… <span class="faint tabular">{progress.done} of {progress.total}</span></p>
		<div class="bar"><div class="fill" style:width="{progress.total ? (progress.done / progress.total) * 100 : 0}%"></div></div>
	</div>
{:else if stage === 'review' || stage === 'adding'}
	<div class="summary">
		<div class="tabs" role="tablist">
			<button type="button" role="tab" class:on={tab === 'add'} aria-selected={tab === 'add'} onclick={() => (tab = 'add')}>To add <span class="count">{toAdd.length}</span></button>
			<button type="button" role="tab" class:on={tab === 'have'} aria-selected={tab === 'have'} onclick={() => (tab = 'have')}>Already in your library <span class="count">{inLibrary.length}</span></button>
			{#if unmatched.length}
				<button type="button" role="tab" class:on={tab === 'none'} aria-selected={tab === 'none'} onclick={() => (tab = 'none')}>Not found <span class="count">{unmatched.length}</span></button>
			{/if}
		</div>
		<div class="act">
			<button type="button" class="btn" onclick={again}>Start over</button>
			<button type="button" class="btn btn-primary" disabled={!picked || stage === 'adding'} onclick={addAll}>
				{stage === 'adding' ? 'Adding…' : `Add ${picked} to your library`}
			</button>
		</div>
	</div>
	{#if problem}<p class="msg bad" role="alert">{problem}</p>{/if}

	{#if tab === 'none'}
		<p class="faint">These couldn't be matched to anything. They can be added from the Add page by name.</p>
		<ul class="plain">
			{#each unmatched as title, i (i)}<li>{title}</li>{/each}
		</ul>
	{:else}
		{#if tab === 'have'}<p class="faint">Already in your library, so left as they are.</p>{/if}
		<ul class="rows">
			{#each shown as row (row.from.join('|'))}
				{@const option = optionOf(row)}
				<li class="row-item" class:off={tab === 'add' && !row.include}>
					{#if tab === 'add'}
						<input type="checkbox" bind:checked={row.include} aria-label="Add {option.title}" />
					{/if}
					<div class="thumb">{#if option.posterUrl}<img src={option.posterUrl} alt="" loading="lazy" />{/if}</div>
					<div class="what">
						{#if row.options.length > 1 && tab === 'add'}
							<select bind:value={row.selected} aria-label="Which title this is">
								{#each row.options as o (o.key)}
									<option value={o.key}>{o.title} ({o.year ?? '?'}, {o.kind})</option>
								{/each}
							</select>
						{:else}
							<strong>{option.title}</strong> <span class="faint">{option.year ?? ''}</span>
						{/if}
						<span class="faint from" title={row.from.join(', ')}>
							{row.from.length > 1 ? `${row.from.length} seasons: ` : ''}{row.from.join(', ')}
						</span>
					</div>
					<div class="facts">
						<span class="chip">{statusLabel(row.status)}</span>
						{#if row.lastSeason && row.lastEpisode && row.status !== 'completed'}<span class="faint tabular">S{row.lastSeason} E{row.lastEpisode}</span>{/if}
						{#if row.rating !== null}<span class="faint tabular">{rated(row.rating)}</span>{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
{:else if stage === 'done'}
	<div class="done">
		<h2>Added {outcome.imported}</h2>
		<p class="muted">{outcome.skipped ? `${outcome.skipped} were already in your library and were left as they are.` : 'Everything on the list is in your library now.'}</p>
		<div class="row">
			<a class="btn btn-primary" href="/?library=1">Open the library</a>
			<button type="button" class="btn" onclick={again}>Import another</button>
		</div>
	</div>
{/if}

<style>
	.back {
		display: inline-block;
		font-size: 0.85rem;
		margin-bottom: 14px;
	}

	h1 {
		font-size: clamp(1.6rem, 4vw, 2.2rem);
		margin-bottom: 8px;
	}

	.lede {
		max-width: 60ch;
		margin: 0 0 18px;
	}

	.notice {
		background: var(--warn-bg);
		border: 1px solid var(--warn);
		color: var(--warn);
		border-radius: var(--radius);
		padding: 10px 14px;
		font-size: 0.88rem;
	}

	.sites {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 12px;
		max-width: 960px;
	}

	.site {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		padding: 16px;
		border: 1px solid var(--rule);
		border-radius: 12px;
		background: var(--surface);
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: border-color 0.15s;
	}

	.site:hover {
		border-color: var(--rule-firm);
	}

	.site.on {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}

	.site .faint {
		font-size: 0.82rem;
	}

	.give {
		margin-top: 20px;
		max-width: 640px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.help {
		margin: 0;
		font-size: 0.88rem;
		line-height: 1.45;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.row input[type='text'] {
		flex: 1;
		min-width: 200px;
	}

	.file {
		font-size: 0.85rem;
	}

	.matching {
		max-width: 520px;
		margin-top: 20px;
	}

	.bar {
		height: 6px;
		border-radius: 3px;
		background: var(--surface-2);
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.3s;
	}

	.summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		margin: 14px 0;
	}

	.tabs {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.tabs button {
		padding: 7px 12px;
		border: 1px solid var(--rule);
		border-radius: 999px;
		background: var(--surface);
		color: var(--ink-soft);
		font: inherit;
		font-size: 0.86rem;
		cursor: pointer;
	}

	.tabs button.on {
		border-color: var(--accent);
		color: var(--ink);
		background: var(--accent-bg);
	}

	.count {
		margin-left: 4px;
		font-weight: 700;
	}

	.act {
		display: flex;
		gap: 8px;
	}

	.rows,
	.plain {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.row-item {
		display: grid;
		grid-template-columns: auto 44px 1fr auto;
		align-items: center;
		gap: 12px;
		padding: 8px 4px;
		border-bottom: 1px solid var(--rule);
	}

	.row-item.off {
		opacity: 0.5;
	}

	.thumb {
		width: 44px;
		aspect-ratio: 2 / 3;
		border-radius: 4px;
		background: var(--surface-2);
		overflow: hidden;
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.what {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.what select {
		max-width: 420px;
		font-size: 0.9rem;
		padding: 4px 6px;
	}

	.from {
		font-size: 0.78rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.facts {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 0.82rem;
	}

	.chip {
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--surface-2);
		font-size: 0.78rem;
		white-space: nowrap;
	}

	.plain li {
		padding: 6px 0;
		border-bottom: 1px solid var(--rule);
		font-size: 0.9rem;
	}

	.done {
		margin-top: 20px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	@media (max-width: 620px) {
		.row-item {
			grid-template-columns: auto 40px 1fr;
		}
		.facts {
			grid-column: 3;
		}
	}
</style>
