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

	let entries = $state<ProgressEntry[]>([]);
	let loading = $state(true);
	let clearing = $state(false);

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

	function epLabel(e: ProgressEntry): string {
		if (e.type === 'movie') return '';
		return `S${e.season}E${e.episode}`;
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
	{:else if entries.length === 0}
		<p class="muted">No watch progress saved.</p>
	{:else}
		<div class="toolbar">
			<span class="count muted">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span>
			<button class="btn btn-danger" onclick={clearAll} disabled={clearing}>
				{clearing ? 'Clearing…' : 'Clear all'}
			</button>
		</div>

		<ul class="list">
			{#each entries as entry (entry.title + entry.type + entry.season + entry.episode)}
				<li class="row">
					<div class="info">
						<span class="title">{entry.title}</span>
						<span class="details muted">
							{entry.type === 'tv' ? 'TV' : 'Movie'}
							{#if epLabel(entry)}<span class="ep">{epLabel(entry)}</span>{/if}
							· {fmt(entry.currentTime)} / {fmt(entry.duration)}
							<span class="pct">({pct(entry.currentTime, entry.duration)})</span>
						</span>
					</div>
					<button class="btn-remove" onclick={() => deleteOne(entry)} title="Remove">✕</button>
				</li>
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

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 14px;
		border-bottom: 1px solid var(--rule);
	}

	.row:last-child {
		border-bottom: none;
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

	.ep {
		font-weight: 600;
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
