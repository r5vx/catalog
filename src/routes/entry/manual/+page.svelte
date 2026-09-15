<script lang="ts">
	import EntryForm from '$lib/EntryForm.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Manual add · Catalog</title></svelte:head>

<header>
	<a href="/entry/new" class="back faint">&larr; Search instead</a>
	<h1>Manual add</h1>
	<p class="muted sub">Only the title is required.</p>
</header>

{#if form?.error}
	<p class="error" role="alert">{form.error}</p>
{/if}

<form method="POST">
	<EntryForm categories={data.categories} entry={data.defaults} submitLabel="Add to library" />
</form>

<style>
	header {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 26px;
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

	.sub {
		font-size: 0.92rem;
		max-width: 58ch;
	}

	.error {
		background: var(--accent-bg);
		border: 1px solid var(--accent);
		color: var(--accent);
		border-radius: var(--radius-sm);
		padding: 10px 14px;
		margin: 0 0 20px;
		font-size: 0.9rem;
	}
</style>
