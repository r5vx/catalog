<script lang="ts">
	import CategoryTabs from '$lib/CategoryTabs.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const asText = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

	const when = (iso: string) =>
		new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
</script>

<svelte:head><title>Notes · Catalog</title></svelte:head>

<header>
	<div class="row">
		<h1>Notes</h1>
		<div class="actions">
			<a href="/settings" class="btn" title="Settings" aria-label="Settings">⚙</a>
			<form method="POST" action="?/create">
				<button type="submit" class="btn btn-primary">+ New page</button>
			</form>
		</div>
	</div>
	<p class="muted count tabular">
		{data.notes.length}
		{data.notes.length === 1 ? 'page' : 'pages'}
	</p>
</header>

<CategoryTabs
	categories={data.categories}
	countByCategory={data.countByCategory}
	total={data.total}
	noteCount={data.noteCount}
	active="notes"
/>

{#if data.notes.length === 0}
	<div class="empty">
		<h2>No pages yet</h2>
		<p class="muted">Anything you want to keep that isn't a movie.</p>
		<form method="POST" action="?/create">
			<button type="submit" class="btn btn-primary">+ New page</button>
		</form>
	</div>
{:else}
	<ul class="pages">
		{#each data.notes as note (note.id)}
			<li>
				<a href="/notes/{note.id}" class:locked={note.locked}>
					<span class="top">
						<span class="name">
							{#if note.locked}<span class="padlock" aria-label="Locked">🔒</span>{/if}
							{note.title}
						</span>
						<span class="when faint tabular">{when(note.updatedAt)}</span>
					</span>
					<span class="preview faint">
						{note.locked ? 'Locked' : asText(note.preview) || 'Empty'}
					</span>
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.padlock {
		font-size: 0.8em;
		margin-right: 3px;
	}

	.locked .preview {
		font-style: italic;
	}

	header {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 22px;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 10px 16px;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	@media (max-width: 460px) {
		.actions {
			width: 100%;
		}
		.actions form {
			flex: 1;
		}
		.actions form button {
			width: 100%;
		}
	}

	h1 {
		font-size: clamp(1.8rem, 5vw, 2.4rem);
	}

	.count {
		font-size: 0.85rem;
	}

	.pages {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--rule);
	}

	.pages a {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 14px 4px;
		border-bottom: 1px solid var(--rule);
	}

	/* Title left, date right — a plain flex row, so nothing can reorder it. */
	.top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 16px;
	}

	.pages a:hover {
		background: var(--surface);
	}

	.name {
		font-weight: 600;
		font-size: 1rem;
		overflow-wrap: anywhere;
	}

	.when {
		font-size: 0.78rem;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.preview {
		font-size: 0.85rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
</style>
