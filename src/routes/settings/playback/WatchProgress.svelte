<script lang="ts">
	import { onMount } from 'svelte';
	import ContextMenu, { menuAt, type MenuItem } from '$lib/ContextMenu.svelte';
	import { askText } from '$lib/confirm.svelte';

	interface ProgressEntry {
		title: string;
		type: string;
		season: number;
		episode: number;
		currentTime: number;
		duration: number;
		updatedAt: string;
	}

	interface TitleGroup {
		title: string;
		type: string;
		latestUpdated: string;
		entries: ProgressEntry[];
	}

	let entries = $state<ProgressEntry[]>([]);
	let loading = $state(true);
	let clearing = $state(false);
	let expanded = $state<Set<string>>(new Set());
	let menu = $state<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
	let clearProblem = $state('');

	const grouped = $derived.by(() => {
		const map = new Map<string, TitleGroup>();
		for (const e of entries) {
			const key = `${e.title}:${e.type}`;
			let g = map.get(key);
			if (!g) {
				g = { title: e.title, type: e.type, latestUpdated: e.updatedAt, entries: [] };
				map.set(key, g);
			}
			g.entries.push(e);
			if (e.updatedAt > g.latestUpdated) g.latestUpdated = e.updatedAt;
		}
		const groups = [...map.values()];
		groups.sort((a, b) => b.latestUpdated.localeCompare(a.latestUpdated));
		for (const g of groups) {
			g.entries.sort((a, b) => a.season - b.season || a.episode - b.episode);
		}
		return groups;
	});

	function fmt(seconds: number): string {
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		const s = Math.floor(seconds % 60);
		return h > 0
			? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
			: `${m}:${String(s).padStart(2, '0')}`;
	}

	function pct(current: number, total: number): string {
		if (!total) return '0%';
		return `${Math.round((current / total) * 100)}%`;
	}

	/** Watched to the end (90%, as the player's ticks count it). These rows are the ticks, so they stay. */
	const finished = (e: ProgressEntry) => e.duration > 0 && e.currentTime / e.duration >= 0.9;

	/** Shows whose watched episodes are listed too, not just counted. */
	let showFinished = $state<Set<string>>(new Set());

	function toggleFinished(key: string) {
		const next = new Set(showFinished);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		showFinished = next;
	}

	function toggle(key: string) {
		const next = new Set(expanded);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		expanded = next;
	}

	async function load() {
		loading = true;
		try {
			const resp = await fetch('/api/watch/progress?all=1');
			if (resp.ok) entries = await resp.json();
		} catch {}
		loading = false;
	}

	async function deleteOne(e: ProgressEntry) {
		const params = new URLSearchParams({
			title: e.title,
			type: e.type,
			season: String(e.season),
			episode: String(e.episode)
		});
		await fetch(`/api/watch/progress?${params}`, { method: 'DELETE' });
		entries = entries.filter(
			(x) => !(x.title === e.title && x.type === e.type && x.season === e.season && x.episode === e.episode)
		);
	}

	async function deleteTitle(g: TitleGroup) {
		await fetch(`/api/watch/progress?title=${encodeURIComponent(g.title)}&type=${g.type}&all_episodes=1`, { method: 'DELETE' });
		entries = entries.filter((x) => !(x.title === g.title && x.type === g.type));
	}

	/**
	 * Right-click a film or show: its whole progress removed at once (owner, 2026-11-26: "quick
	 * delete like an entire show/anime").
	 */
	function groupMenu(event: MouseEvent, g: TitleGroup) {
		event.preventDefault();
		const key = g.title + ':' + g.type;
		const items: MenuItem[] = [];
		const single = g.type === 'movie' || g.type === 'replay';
		if (!single) items.push({ label: expanded.has(key) ? 'Hide episodes' : 'Show episodes', run: () => toggle(key) }, '-');
		items.push({
			label: single ? `Remove ${g.title}'s progress` : `Remove all of ${g.title}'s progress (${g.entries.length})`,
			run: () => (single ? deleteOne(g.entries[0]) : deleteTitle(g)),
			danger: true
		});
		menu = { at: menuAt(event, items.length), items };
	}

	/**
	 * Clear all: only after typing DELETE (owner, 2026-11-26: "i dont want someone accidentally
	 * clicking that and losing everything"). It takes every saved place and every watched tick.
	 */
	async function clearAll() {
		clearProblem = '';
		const typed = await askText({
			title: 'Clear all watch progress?',
			message: `Every saved place and every watched episode tick goes, for all ${grouped.length} titles. This can't be undone. Type DELETE to clear it.`,
			placeholder: 'DELETE',
			confirmLabel: 'Clear everything'
		});
		if (typed === null) return;
		if (typed.toUpperCase() !== 'DELETE') {
			clearProblem = 'Nothing was cleared: type DELETE to clear it all.';
			return;
		}
		clearing = true;
		await fetch('/api/watch/progress', { method: 'DELETE' });
		entries = [];
		clearing = false;
	}

	onMount(load);
</script>


<section>
	<h2 class="label">Watch progress</h2>
	<p class="hint faint">Saved positions for movies and episodes you've been watching.</p>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if grouped.length === 0}
		<p class="muted">No watch progress saved.</p>
	{:else}
		<div class="toolbar">
			<span class="count muted">{entries.length} {entries.length === 1 ? 'entry' : 'entries'} · right-click a title to remove it</span>
		</div>

		<ul class="list">
			{#each grouped as group (group.title + ':' + group.type)}
				{#if group.type === 'movie' || group.type === 'replay'}
					{@const e = group.entries[0]}
					<li class="row" oncontextmenu={(ev) => groupMenu(ev, group)}>
						<div class="info">
							<span class="title">{e.title}</span>
							<span class="details muted">
								{group.type === 'replay' ? 'Replay' : 'Movie'} · {fmt(e.currentTime)} / {fmt(e.duration)}
								<span class="pct">({pct(e.currentTime, e.duration)})</span>
							</span>
						</div>
						<button class="btn-remove" onclick={() => deleteOne(e)} title="Remove">✕</button>
					</li>
				{:else}
					{@const key = group.title + ':' + group.type}
					{@const open = expanded.has(key)}
					{@const watching = group.entries.filter((e) => !finished(e))}
					{@const watched = group.entries.filter(finished)}
					<li class="group">
						<button class="group-header" onclick={() => toggle(key)} oncontextmenu={(ev) => groupMenu(ev, group)}>
							<div class="info">
								<span class="title">{group.title}</span>
								<span class="details muted">
									{[
										group.type === 'tv' ? 'TV' : group.type,
										watching.length ? `${watching.length} in progress` : '',
										watched.length ? `${watched.length} watched` : ''
									].filter(Boolean).join(' · ')}
								</span>
							</div>
							<span class="chevron" class:open>▸</span>
						</button>
						{#if open}
							<ul class="episodes">
								{#each watching as e (e.season + ':' + e.episode)}
									<li class="ep-row">
										<div class="info">
											<span class="ep-label">S{e.season}E{e.episode}</span>
											<span class="details muted">
												{fmt(e.currentTime)} / {fmt(e.duration)}
												<span class="pct">({pct(e.currentTime, e.duration)})</span>
											</span>
										</div>
										<button class="btn-remove" onclick={() => deleteOne(e)} title="Remove">✕</button>
									</li>
								{/each}
								{#if watched.length}
									<li class="ep-row ep-watched-toggle">
										<button class="btn-link" onclick={() => toggleFinished(key)}>
											{showFinished.has(key) ? 'Hide' : 'Show'} {watched.length} watched {watched.length === 1 ? 'episode' : 'episodes'}
										</button>
									</li>
									{#if showFinished.has(key)}
										{#each watched as e (e.season + ':' + e.episode)}
											<li class="ep-row">
												<div class="info">
													<span class="ep-label">S{e.season}E{e.episode}</span>
													<span class="details muted">Watched</span>
												</div>
												<button class="btn-remove" onclick={() => deleteOne(e)} title="Remove (takes its tick off)">✕</button>
											</li>
										{/each}
									{/if}
								{/if}
								<li class="ep-row ep-actions">
									<button class="btn-remove-all" onclick={() => deleteTitle(group)}>Remove all episodes</button>
								</li>
							</ul>
						{/if}
					</li>
				{/if}
			{/each}
		</ul>

		<!-- Out of the way at the bottom, and only after typing DELETE. -->
		<div class="clear-all">
			<button class="btn btn-danger" onclick={clearAll} disabled={clearing}>
				{clearing ? 'Clearing…' : 'Clear all watch progress…'}
			</button>
			{#if clearProblem}<span class="muted small">{clearProblem}</span>{/if}
		</div>
	{/if}
</section>

{#if menu}<ContextMenu at={menu.at} items={menu.items} close={() => (menu = null)} />{/if}

<style>
	.label {
		font-family: var(--body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin: 0 0 8px;
	}

	.hint {
		font-size: 0.8rem;
		margin: 0 0 16px;
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
	}

	.count {
		font-size: 0.82rem;
	}

	.clear-all {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		margin-top: 18px;
	}

	.small {
		font-size: 0.8rem;
	}

	.btn-danger {
		padding: 5px 14px;
		border: 1px solid var(--danger, #c33);
		background: transparent;
		color: var(--danger, #c33);
		border-radius: var(--radius-sm);
		font-size: 0.8rem;
		cursor: pointer;
	}

	.btn-danger:hover:not(:disabled) {
		background: var(--danger, #c33);
		color: var(--paper);
	}

	.btn-danger:disabled {
		opacity: 0.4;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--surface);
	}

	.row, .group {
		border-bottom: 1px solid var(--rule);
	}

	.row:last-child, .group:last-child {
		border-bottom: none;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 14px;
	}

	.group-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		gap: 12px;
		padding: 10px 14px;
		background: none;
		border: none;
		color: inherit;
		cursor: pointer;
		text-align: left;
	}

	.group-header:hover {
		background: var(--surface-2);
	}

	.chevron {
		font-size: 0.9rem;
		color: var(--ink-faint);
		transition: transform 0.15s ease;
	}

	.chevron.open {
		transform: rotate(90deg);
	}

	.episodes {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: 1px solid var(--rule);
		background: var(--sunk, var(--surface-2));
	}

	.ep-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 14px 8px 28px;
		border-bottom: 1px solid var(--rule);
	}

	.ep-row:last-child {
		border-bottom: none;
	}

	.ep-label {
		font-size: 0.85rem;
		font-weight: 600;
	}

	.ep-actions {
		justify-content: flex-end;
		padding: 6px 14px;
	}

	.btn-link {
		padding: 0;
		border: none;
		background: none;
		color: var(--ink-soft);
		font-size: 0.8rem;
		cursor: pointer;
		text-decoration: underline;
	}

	.btn-link:hover {
		color: var(--ink);
	}

	.btn-remove-all {
		padding: 4px 10px;
		border: 1px solid var(--danger, #c33);
		background: transparent;
		color: var(--danger, #c33);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.btn-remove-all:hover {
		background: var(--danger, #c33);
		color: var(--paper);
	}

	.info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.title {
		font-size: 0.9rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.details {
		font-size: 0.78rem;
	}

	.pct {
		opacity: 0.7;
	}

	.btn-remove {
		flex: none;
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-soft);
		font-size: 0.82rem;
		cursor: pointer;
	}

	.btn-remove:hover {
		background: var(--danger, #c33);
		border-color: var(--danger, #c33);
		color: var(--paper);
	}
</style>
