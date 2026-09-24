<script lang="ts">
	import { onMount } from 'svelte';

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

	async function clearAll() {
		clearing = true;
		await fetch('/api/watch/progress', { method: 'DELETE' });
		entries = [];
		clearing = false;
	}

	onMount(load);
</script>

<svelte:head><title>Watch Progress · Settings · Catalog</title></svelte:head>

<section>
	<h2 class="label">Watch progress</h2>
	<p class="hint faint">Saved positions for movies and episodes you've been watching.</p>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if grouped.length === 0}
		<p class="muted">No watch progress saved.</p>
	{:else}
		<div class="toolbar">
			<span class="count muted">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span>
			<button class="btn btn-danger" onclick={clearAll} disabled={clearing}>
				{clearing ? 'Clearing…' : 'Clear all'}
			</button>
		</div>

		<ul class="list">
			{#each grouped as group (group.title + ':' + group.type)}
				{#if group.type === 'movie'}
					{@const e = group.entries[0]}
					<li class="row">
						<div class="info">
							<span class="title">{e.title}</span>
							<span class="details muted">
								Movie · {fmt(e.currentTime)} / {fmt(e.duration)}
								<span class="pct">({pct(e.currentTime, e.duration)})</span>
							</span>
						</div>
						<button class="btn-remove" onclick={() => deleteOne(e)} title="Remove">✕</button>
					</li>
				{:else}
					{@const key = group.title + ':' + group.type}
					{@const open = expanded.has(key)}
					<li class="group">
						<button class="group-header" onclick={() => toggle(key)}>
							<div class="info">
								<span class="title">{group.title}</span>
								<span class="details muted">
									{group.type === 'tv' ? 'TV' : group.type} · {group.entries.length} {group.entries.length === 1 ? 'episode' : 'episodes'}
								</span>
							</div>
							<span class="chevron" class:open>▸</span>
						</button>
						{#if open}
							<ul class="episodes">
								{#each group.entries as e (e.season + ':' + e.episode)}
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
								<li class="ep-row ep-actions">
									<button class="btn-remove-all" onclick={() => deleteTitle(group)}>Remove all episodes</button>
								</li>
							</ul>
						{/if}
					</li>
				{/if}
			{/each}
		</ul>
	{/if}
</section>

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
