<script lang="ts">
	import { goto } from '$app/navigation';
	import NoteEditor from '$lib/NoteEditor.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	async function save(title: string, body: string) {
		const response = await fetch('/api/notes', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: data.note.id, title, body })
		});
		if (!response.ok) throw new Error('save failed');
	}

	async function remove() {
		if (!confirm(`Delete "${data.note.title}"?`)) return;

		await fetch('/api/notes', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: data.note.id })
		});
		goto('/notes');
	}
</script>

<svelte:head><title>{data.note.title} · Catalog</title></svelte:head>

<a href="/notes" class="back faint">&larr; Notes</a>

<NoteEditor initialTitle={data.note.title} initialBody={data.note.body} onsave={save} />

<div class="danger-zone">
	<button type="button" class="btn btn-danger" onclick={remove}>Delete this page</button>
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

	.danger-zone {
		margin-top: 40px;
		padding-top: 20px;
		border-top: 1px solid var(--rule);
	}
</style>
