<script lang="ts">
	import MoreButton from '$lib/MoreButton.svelte';
	import { goto, invalidateAll, beforeNavigate } from '$app/navigation';
	import { statusLabel, sortBadge } from '$lib/constants';
	import { onMount, tick } from 'svelte';

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
		source?: string;
		sourceId?: string;
		tags: string[];
		rating?: number | null;
		favorite?: boolean;
		notes?: string;
	};

	type Friend = { id: number; name: string; titlesCount: number; importedAt: string };

	type Props = {
		owned: Set<string>;
		ownedMap?: Record<string, number>;
		poisonMode?: boolean;
	};

	let { owned, ownedMap = {}, poisonMode = false }: Props = $props();

	let friends = $state<Friend[]>([]);
	let activeFriend = $state<number | null>(null);
	let titles = $state<SharedTitle[]>([]);
	let loadingFriend = $state(false);
	let problem = $state('');

	let search = $state('');
	let category = $state('');
	let show = $state('no_planned');
	let sort = $state('title');

	const STORAGE_KEY = 'catalog-friends-state';

	function saveFriendsState() {
		try {
			const el = document.querySelector('.grid');
			sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
				activeFriend, search, category, show, sort,
				scrollY: el ? el.parentElement?.scrollTop ?? window.scrollY : window.scrollY
			}));
		} catch {}
	}

	function restoreFriendsState() {
		try {
			const raw = sessionStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const s = JSON.parse(raw);
			if (s.activeFriend != null) {
				activeFriend = s.activeFriend;
				loadFriend(s.activeFriend);
			}
			if (s.search) search = s.search;
			if (s.category) category = s.category;
			if (s.show) show = s.show;
			if (s.sort) sort = s.sort;
			if (s.scrollY) {
				tick().then(() => setTimeout(() => window.scrollTo(0, s.scrollY), 100));
			}
		} catch {}
	}

	beforeNavigate(() => { saveFriendsState(); });

	let ctxMenu = $state<{ x: number; y: number; row: SharedTitle } | null>(null);
	let justAdded = $state<Record<string, number>>({});
	let justRemoved = $state<Set<string>>(new Set());
	let busy = $state<string | null>(null);

	const SORTS = [
		{ value: 'title', label: 'Title (A–Z)' },
		{ value: 'year', label: 'Newest release' },
		{ value: 'oldest', label: 'Oldest release' },
		{ value: 'rating', label: 'Their rating' },
		{ value: 'public', label: 'TMDB / AniList' },
		{ value: 'imdb', label: 'IMDb rating' },
		{ value: 'rt', label: 'Rotten Tomatoes' },
		{ value: 'metacritic', label: 'Metacritic' },
	];

	const SHOW = [
		{ value: 'no_planned', label: 'Watched only' },
		{ value: '', label: 'Everything' },
		{ value: 'new', label: "Only what I haven't seen" },
		{ value: 'both', label: "Only what we've both seen" },
		{ value: 'watchlist', label: "Their watchlist" }
	];

	const normalise = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
	const keyOf = (row: SharedTitle) => row.source && row.sourceId ? `${row.source}:${row.sourceId}` : `title:${normalise(row.title)}`;

	function isMine(row: SharedTitle): boolean {
		const k = keyOf(row);
		if (justRemoved.has(k)) return false;
		if (k in justAdded) return true;
		if (row.source && row.sourceId && owned.has(`${row.source}:${row.sourceId}`)) return true;
		return false;
	}

	function entryIdOfRow(row: SharedTitle): number | null {
		const k = keyOf(row);
		if (justAdded[k]) return justAdded[k];
		if (row.source && row.sourceId) return ownedMap[`${row.source}:${row.sourceId}`] ?? null;
		return null;
	}

	async function removeFromLibrary(row: SharedTitle) {
		const id = entryIdOfRow(row);
		if (!id) return;
		try {
			await fetch('/api/entries', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			justRemoved = new Set([...justRemoved, keyOf(row)]);
		} catch {}
	}

	function sortValue(row: SharedTitle, by: string): number | null {
		switch (by) {
			case 'year': case 'oldest': return row.year ?? null;
			case 'rating': return row.rating ?? null;
			case 'public': return row.externalRating ?? null;
			case 'imdb': return row.imdbRating ?? null;
			case 'rt': return row.rtScore ?? null;
			case 'metacritic': return row.metascore ?? null;
			default: return null;
		}
	}

	const categories = $derived([...new Set(titles.map((t) => t.category))]);

	const rows = $derived.by(() => {
		const needle = search.trim().toLowerCase();
		const kept = titles
			.map((t) => ({ ...t, owned: isMine(t) }))
			.filter((row) =>
				(!category || row.category === category) &&
				(show !== 'new' || !row.owned) &&
				(show !== 'both' || row.owned) &&
				(show !== 'no_planned' || (row.status !== 'planned' && row.status !== 'want to watch')) &&
			(show !== 'watchlist' || row.status === 'planned' || row.status === 'want to watch') &&
				(!needle || row.title.toLowerCase().includes(needle))
			);

		if (sort === 'title') return kept.sort((a, b) => a.title.localeCompare(b.title));
		const ascending = sort === 'oldest';
		return kept.sort((a, b) => {
			const left = sortValue(a, sort);
			const right = sortValue(b, sort);
			if (left == null && right == null) return a.title.localeCompare(b.title);
			if (left == null) return 1;
			if (right == null) return -1;
			if (left === right) return a.title.localeCompare(b.title);
			return ascending ? left - right : right - left;
		});
	});

	const overlap = $derived(titles.filter((t) => isMine(t)).length);

	async function loadFriends() {
		try {
			const resp = await fetch('/api/shared');
			if (resp.ok) friends = (await resp.json()).catalogs;
		} catch {}
	}

	async function loadFriend(id: number) {
		loadingFriend = true;
		activeFriend = id;
		try {
			const resp = await fetch(`/api/shared?id=${id}`);
			if (resp.ok) {
				const data = await resp.json();
				titles = data.titles;
			}
		} catch {} finally { loadingFriend = false; }
	}

	async function removeFriend(id: number) {
		await fetch(`/api/shared?id=${id}`, { method: 'DELETE' });
		friends = friends.filter((f) => f.id !== id);
		if (activeFriend === id) { activeFriend = null; titles = []; }
		invalidateAll();
	}

	async function importFile(file: File) {
		problem = '';
		const text = await file.text();
		try {
			const parsed = JSON.parse(text);
			if (!parsed?.catalogShare || !Array.isArray(parsed.titles)) {
				problem = 'Not a shared library. Ask them for the file from Settings → Library → Share.';
				return;
			}
			const resp = await fetch('/api/shared', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: text
			});
			if (resp.ok) {
				const added = await resp.json();
				await loadFriends();
				loadFriend(added.id);
				invalidateAll();
			}
		} catch { problem = 'That file is not readable JSON.'; }
	}

	const link = (row: SharedTitle) =>
		row.source && row.sourceId
			? `/title/${row.source}/${encodeURIComponent(row.sourceId)}?back=${encodeURIComponent('/?cat=friends')}`
			: null;

	function onCardContext(e: MouseEvent, row: SharedTitle) {
		e.preventDefault();
		const x = Math.min(e.clientX, window.innerWidth - 200);
		const y = Math.min(e.clientY, window.innerHeight - 220);
		ctxMenu = { x, y, row };
	}

	function closeCtx() { ctxMenu = null; }

	async function add(row: SharedTitle, status: string) {
		if (!row.source || !row.sourceId) return;
		busy = keyOf(row);
		try {
			const resp = await fetch('/api/add', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ source: row.source, sourceId: row.sourceId, status })
			});
			if (resp.ok) {
				const added = await resp.json();
				justAdded = { ...justAdded, [keyOf(row)]: added.id };
			}
		} catch {} finally { busy = null; }
	}

	$effect(() => { loadFriends().then(() => restoreFriendsState()); });

	const activeName = $derived(friends.find((f) => f.id === activeFriend)?.name ?? '');
</script>

{#if friends.length === 0 && !activeFriend}
	<div class="empty-state">
		<h2>No friends imported yet</h2>
		<p class="muted">Someone shares their catalog from Settings → Library → Share. Open their file here.</p>

		{#if problem}
			<p class="msg bad" role="alert">{problem}</p>
		{/if}

		<label class="drop">
			<input type="file" accept="application/json,.json" onchange={(e) => { const f = e.currentTarget.files?.[0]; if (f) importFile(f); }} />
			<span class="drop-label">Import a friend's catalog</span>
		</label>
	</div>
{:else}
	<div class="friends-header">
		<div class="friend-picker">
			{#each friends as friend (friend.id)}
				<button
					type="button"
					class="friend-chip"
					class:active={activeFriend === friend.id}
					onclick={() => loadFriend(friend.id)}
				>
					{friend.name}
					<span class="friend-count">{friend.titlesCount}</span>
				</button>
			{/each}

			<label class="friend-chip add-chip">
				<input type="file" accept="application/json,.json" onchange={(e) => { const f = e.currentTarget.files?.[0]; if (f) importFile(f); e.currentTarget.value = ''; }} />
				+ Add
			</label>
		</div>

		{#if activeFriend}
			<button type="button" class="btn btn-danger tiny" onclick={() => removeFriend(activeFriend!)}>Remove {activeName}</button>
		{/if}
	</div>

	{#if problem}
		<p class="msg bad" role="alert">{problem}</p>
	{/if}

	{#if loadingFriend}
		<p class="muted">Loading...</p>
	{:else if activeFriend && titles.length > 0}
		<p class="muted tabular friend-stats">
			{titles.length} titles · {overlap} you've also seen
		</p>

		<div class="toolbar">
			<input type="search" placeholder="Search their titles..." bind:value={search} />
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
					<li class="card has-more" class:mine={row.owned} oncontextmenu={(e) => onCardContext(e, row)}>
						{#if link(row)}
							<a href={link(row)} class="card-link" aria-label={row.title}></a>
						{/if}
						<div class="poster">
							{#if row.posterUrl}
								<img src={row.posterUrl} alt="" loading="lazy" />
							{:else}
								<span class="fallback" aria-hidden="true">?</span>
							{/if}
							{#if row.owned}<span class="tick" title="In your library">&check;</span>{/if}
							<MoreButton onopen={(e) => onCardContext(e, row)} top={row.owned ? 36 : 6} />
							{#if row.owned}
								<button type="button" class="hover-remove" title="Remove from library" onclick={(e) => { e.preventDefault(); e.stopPropagation(); removeFromLibrary(row); }}>&times;</button>
							{/if}
						</div>

						<span class="name">{row.title}</span>

						<p class="sub faint tabular">
							{row.year ?? '—'}{#if row.status !== 'completed'}&nbsp;· {statusLabel(row.status)}{/if}
						</p>

						<p class="scores tabular">
							{#if sortBadge(row, sort)}
								<span class="sorted">{sortBadge(row, sort)}</span>
							{/if}
							{#if row.rating != null}
								<span class="theirs">{row.rating}/10</span>
							{/if}
							{#if row.externalRating != null}
								<span class="faint">{row.externalRating.toFixed(1)}</span>
							{/if}
							{#if row.favorite}<span class="star">★</span>{/if}
						</p>

						{#if justAdded[keyOf(row)]}
							<a class="added" href="/entry/{justAdded[keyOf(row)]}">Added →</a>
						{:else if row.owned}
							<span class="added faint">Already yours</span>
						{:else if row.source && row.sourceId}
							<div class="actions">
								<button type="button" class="btn tiny" disabled={busy === keyOf(row)} onclick={() => add(row, 'completed')} style="position:relative;z-index:2">
									✓ Seen it
								</button>
								<button type="button" class="btn tiny" disabled={busy === keyOf(row)} onclick={() => add(row, 'planned')} style="position:relative;z-index:2">
									Watchlist
								</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{:else if activeFriend}
		<p class="muted">This catalog is empty.</p>
	{:else}
		<p class="muted">Pick a friend above to see their library.</p>
	{/if}
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if ctxMenu}
	<div class="ctx-backdrop" onclick={closeCtx} oncontextmenu={(e) => { e.preventDefault(); closeCtx(); }}></div>
	<div class="ctx-menu" style="left: {ctxMenu.x}px; top: {ctxMenu.y}px;">
		{#if link(ctxMenu.row)}
			<button type="button" onclick={() => {
				const r = ctxMenu!.row;
				const t = r.category === 'Movies' ? 'movie' : 'tv';
				goto(`/watch?title=${encodeURIComponent(r.title)}&type=${t}${r.year ? `&year=${r.year}` : ''}&auto=1`);
				closeCtx();
			}}>▶ Watch</button>
			<button type="button" onclick={() => { goto(link(ctxMenu!.row)!); closeCtx(); }}>View details</button>
			<hr />
		{/if}
		{#if isMine(ctxMenu.row)}
			{#if entryIdOfRow(ctxMenu.row)}
				<button type="button" onclick={() => { goto(`/entry/${entryIdOfRow(ctxMenu!.row)}`); closeCtx(); }}>View entry</button>
			{/if}
			<hr />
			<button type="button" class="ctx-danger" onclick={() => { removeFromLibrary(ctxMenu!.row); closeCtx(); }}>Remove from library</button>
		{:else if ctxMenu.row.source && ctxMenu.row.sourceId}
			<button type="button" onclick={() => { add(ctxMenu!.row, 'completed'); closeCtx(); }}>✓ Add as completed</button>
			<button type="button" onclick={() => { add(ctxMenu!.row, 'watching'); closeCtx(); }}>Add as watching</button>
			<button type="button" onclick={() => { add(ctxMenu!.row, 'planned'); closeCtx(); }}>Add to watchlist</button>
		{/if}
	</div>
{/if}

<style>
	.empty-state {
		max-width: 46ch;
		margin: 4vh 0 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: flex-start;
	}

	.drop {
		width: 100%;
		border: 1px dashed var(--rule-firm);
		border-radius: var(--radius);
		padding: 26px;
		text-align: center;
		cursor: pointer;
		background: var(--surface);
	}

	.drop:hover { border-color: var(--accent); }
	.drop input { position: absolute; width: 1px; height: 1px; opacity: 0; }

	.drop-label { font-weight: 600; color: var(--accent); }

	.friends-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 14px;
	}

	.friend-picker {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.friend-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		border-radius: 100px;
		border: 1px solid var(--rule);
		background: var(--surface);
		color: var(--ink-soft);
		font-size: 0.88rem;
		cursor: pointer;
	}

	.friend-chip:hover { border-color: var(--accent); color: var(--ink); }
	.friend-chip.active { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }

	.friend-count { font-size: 0.72rem; opacity: 0.65; }

	.add-chip { border-style: dashed; }
	.add-chip input { position: absolute; width: 1px; height: 1px; opacity: 0; }
	.add-chip:hover { border-color: var(--accent); color: var(--accent); }

	.friend-stats { margin: 0 0 12px; font-size: 0.88rem; }

	.toolbar {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		align-items: center;
		margin-bottom: 18px;
	}

	.toolbar input[type='search'] { flex: 1; min-width: 180px; }
	.toolbar select { width: auto; }

	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 24px 16px;
	}

	.card { position: relative; }

	.card-link {
		position: absolute;
		inset: 0;
		z-index: 1;
	}

	.poster {
		position: relative;
		display: grid;
		place-items: center;
		aspect-ratio: 2 / 3;
		background: var(--surface-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		overflow: hidden;
		margin-bottom: 7px;
	}

	.poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
	.card:hover .poster { border-color: var(--accent); }
	.mine .poster img { opacity: 0.45; }

	.fallback { font-size: 1.8rem; opacity: 0.4; }

	.tick {
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
		font-size: 0.9rem;
		font-weight: 600;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}

	.card:hover .name { color: var(--accent); }
	.sub { font-size: 0.78rem; margin: 2px 0 0; }

	.scores {
		font-size: 0.78rem;
		margin: 2px 0 0;
		display: flex;
		gap: 8px;
		align-items: baseline;
		flex-wrap: wrap;
	}

	.sorted { color: var(--ink); font-weight: 600; }
	.theirs { color: var(--accent); font-weight: 600; }
	.star { color: var(--accent); }

	.actions {
		display: flex;
		gap: 6px;
		margin-top: 6px;
	}

	.tiny { font-size: 0.74rem; padding: 4px 9px; }

	.added {
		display: inline-block;
		margin-top: 6px;
		font-size: 0.76rem;
		font-weight: 600;
		color: var(--good);
		position: relative;
		z-index: 2;
	}

	.msg { border: 1px solid var(--rule-firm); border-radius: var(--radius-sm); padding: 9px 13px; margin: 0 0 16px; font-size: 0.89rem; background: var(--surface); }
	.bad { background: var(--accent-bg); border-color: var(--accent); color: var(--accent); }

	.ctx-backdrop { position: fixed; inset: 0; z-index: 900; }

	.ctx-menu {
		position: fixed;
		z-index: 901;
		min-width: 180px;
		background: var(--surface, #1e1e1e);
		border: 1px solid var(--rule, #333);
		border-radius: var(--radius-sm, 6px);
		padding: 4px 0;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}

	.ctx-menu button {
		display: block;
		width: 100%;
		padding: 8px 14px;
		border: none;
		background: none;
		color: var(--ink, #ddd);
		text-align: left;
		font-size: 0.84rem;
		cursor: pointer;
	}

	.ctx-menu button:hover { background: var(--accent); color: var(--accent-ink, #fff); }
	.ctx-menu hr { border: none; border-top: 1px solid var(--rule, #333); margin: 4px 0; }
	.ctx-info { display: block; padding: 8px 14px; font-size: 0.84rem; color: var(--good); font-weight: 600; }

	.ctx-danger { color: var(--danger, #c33) !important; }
	.ctx-danger:hover { background: var(--danger, #c33) !important; color: #fff !important; }

	.hover-remove {
		position: absolute;
		top: 6px;
		left: 6px;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: none;
		background: rgba(0,0,0,0.65);
		color: #fff;
		font-size: 1.1rem;
		line-height: 1;
		display: grid;
		place-items: center;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.12s ease;
		z-index: 2;
	}

	.card:hover .hover-remove { opacity: 1; }
	.hover-remove:hover { background: var(--danger, #c33); }
</style>
