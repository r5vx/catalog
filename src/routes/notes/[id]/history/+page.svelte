<script lang="ts">
	import { goto } from '$app/navigation';
	import NoteView from '$lib/NoteView.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** null = the page as it is now. */
	let selectedId = $state<number | null>(null);
	const selected = $derived(data.versions.find((v) => v.id === selectedId) ?? null);
	let problem = $state('');
	let restoring = $state(false);

	const stamp = (iso: string) =>
		new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

	/** Word count from the HTML, for telling versions apart at a glance. */
	function words(html: string) {
		const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();
		const n = text ? text.split(/\s+/).length : 0;
		return `${n} ${n === 1 ? 'word' : 'words'}`;
	}

	async function restore() {
		if (!selected) return;
		restoring = true;
		problem = '';
		const response = await fetch('/api/notes', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: data.note.id, action: 'version', versionId: selected.id })
		});
		restoring = false;
		if (!response.ok) {
			problem = "That version couldn't be restored. Try again.";
			return;
		}
		goto(`/notes/${data.note.id}`, { invalidateAll: true });
	}
</script>

<svelte:head><title>Version history · {data.note.title} · Catalog</title></svelte:head>

<a href="/notes/{data.note.id}" class="back faint">&larr; {data.note.title}</a>

<h1>Version history</h1>
<p class="muted lede">Saved as you edit, and just before most of a page is deleted.</p>

{#if problem}<p class="msg bad" role="alert">{problem}</p>{/if}

<div class="layout">
	<ol class="versions">
		<li>
			<button type="button" class:active={selectedId === null} onclick={() => (selectedId = null)}>
				<span class="v-when">Now</span>
				<span class="v-meta faint">{words(data.note.body)}</span>
			</button>
		</li>
		{#each data.versions as version (version.id)}
			<li>
				<button type="button" class:active={selectedId === version.id} onclick={() => (selectedId = version.id)}>
					<span class="v-when tabular">{stamp(version.savedAt)}</span>
					<span class="v-meta faint">{version.title} · {words(version.body)}</span>
				</button>
			</li>
		{/each}
		{#if data.versions.length === 0}
			<li class="none faint">No earlier versions yet. They appear as you edit.</li>
		{/if}
	</ol>

	<section class="preview">
		<div class="preview-bar">
			<span class="faint">{selected ? `Version from ${stamp(selected.savedAt)}` : 'The page as it is now'}</span>
			{#if selected}
				<button type="button" class="btn btn-primary" disabled={restoring} onclick={restore}>
					{restoring ? 'Restoring…' : 'Restore this version'}
				</button>
			{/if}
		</div>
		<NoteView title={selected?.title ?? data.note.title} body={selected?.body ?? data.note.body} />
	</section>
</div>

<style>
	.back {
		font-size: 0.85rem;
		display: inline-block;
		margin-bottom: 10px;
	}

	.back:hover {
		color: var(--accent);
	}

	h1 {
		font-size: clamp(1.6rem, 4.5vw, 2.1rem);
	}

	.lede {
		margin: 4px 0 18px;
		font-size: 0.88rem;
		max-width: 70ch;
	}

	.layout {
		display: grid;
		grid-template-columns: 260px 1fr;
		gap: 20px;
		align-items: start;
	}

	.versions {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		overflow: hidden;
		max-height: 75vh;
		overflow-y: auto;
		position: sticky;
		top: 16px;
	}

	.versions li + li {
		border-top: 1px solid var(--rule);
	}

	.versions button {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		padding: 10px 12px;
		border: none;
		background: var(--surface);
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		font: inherit;
	}

	.versions button:hover {
		background: var(--surface-2);
	}

	.versions button.active {
		background: var(--accent-bg);
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.v-when {
		font-weight: 600;
		font-size: 0.88rem;
	}

	.v-meta {
		font-size: 0.76rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.none {
		padding: 12px;
		font-size: 0.85rem;
	}

	.preview-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		min-height: 38px;
		margin-bottom: 10px;
		font-size: 0.85rem;
	}

	@media (max-width: 720px) {
		.layout {
			grid-template-columns: 1fr;
		}

		.versions {
			position: static;
			max-height: 260px;
		}
	}
</style>
