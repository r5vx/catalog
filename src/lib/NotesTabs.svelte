<!--
	Above the notes: All pages, one chip per tag, and Recently deleted (only while something's
	been deleted). Right-click a tag to rename or delete it.
-->
<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { confirmAction, askText } from '$lib/confirm.svelte';

	type Tag = { id: number; name: string; count: number };

	let {
		pageCount,
		deletedCount,
		tags,
		active
	}: { pageCount: number; deletedCount: number; tags: Tag[]; active: 'pages' | 'deleted' | number } = $props();

	let menu = $state<{ x: number; y: number; tag: Tag } | null>(null);

	function openMenu(e: MouseEvent, tag: Tag) {
		e.preventDefault();
		menu = { x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 120), tag };
	}

	async function rename(tag: Tag) {
		menu = null;
		const name = await askText({ title: 'Rename tag', value: tag.name, confirmLabel: 'Rename' });
		if (!name || name === tag.name) return;
		const response = await fetch('/api/notes/tags', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: tag.id, name })
		});
		if (response.status === 409) {
			await confirmAction({ title: `There's already a tag called "${name}".`, confirmLabel: 'OK', cancelLabel: 'Close' });
		}
		invalidateAll();
	}

	async function remove(tag: Tag) {
		menu = null;
		const yes = await confirmAction({
			title: `Delete the "${tag.name}" tag?`,
			message: 'The pages stay; they just lose the tag.',
			confirmLabel: 'Delete tag'
		});
		if (!yes) return;
		await fetch('/api/notes/tags', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: tag.id })
		});
		if (active === tag.id) goto('/notes', { invalidateAll: true });
		else invalidateAll();
	}
</script>

<nav class="subtabs" aria-label="Notes">
	<a href="/notes" class="subtab" class:active={active === 'pages'} aria-current={active === 'pages' ? 'page' : undefined}>
		All pages <span class="n tabular">{pageCount}</span>
	</a>
	{#each tags as tag (tag.id)}
		<a
			href="/notes?tag={tag.id}"
			class="subtab"
			class:active={active === tag.id}
			aria-current={active === tag.id ? 'page' : undefined}
			oncontextmenu={(e) => openMenu(e, tag)}
		>
			<span class="hash" aria-hidden="true">#</span>{tag.name} <span class="n tabular">{tag.count}</span>
		</a>
	{/each}
	{#if deletedCount > 0 || active === 'deleted'}
		<a href="/notes/deleted" class="subtab trash" class:active={active === 'deleted'} aria-current={active === 'deleted' ? 'page' : undefined}>
			🗑 Recently deleted <span class="n tabular">{deletedCount}</span>
		</a>
	{/if}
</nav>

{#if menu}
	{@const tag = menu.tag}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="ctx-backdrop" onclick={() => (menu = null)} oncontextmenu={(e) => { e.preventDefault(); menu = null; }}></div>
	<div class="ctx-menu" style="left: {menu.x}px; top: {menu.y}px;">
		<button type="button" onclick={() => rename(tag)}>Rename tag</button>
		<hr />
		<button type="button" class="ctx-danger" onclick={() => remove(tag)}>Delete tag</button>
	</div>
{/if}

<style>
	.subtabs {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 14px;
	}

	.subtab {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 12px;
		border-radius: 100px;
		border: 1px solid var(--rule);
		color: var(--ink-soft);
		font-size: 0.85rem;
	}

	.subtab:hover {
		color: var(--ink);
		border-color: var(--rule-firm);
	}

	.subtab.active {
		background: var(--surface-2);
		border-color: var(--rule-firm);
		color: var(--ink);
		font-weight: 600;
	}

	/* Recently deleted sits at the far end, away from the tags. */
	.trash {
		margin-left: auto;
	}

	.hash {
		margin-right: -4px;
		color: var(--ink-faint);
	}

	.n {
		font-size: 0.75rem;
		opacity: 0.65;
	}

	.ctx-backdrop {
		position: fixed;
		inset: 0;
		z-index: 900;
	}

	.ctx-menu {
		position: fixed;
		z-index: 901;
		min-width: 170px;
		padding: 4px 0;
		background: var(--surface);
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}

	.ctx-menu button {
		display: block;
		width: 100%;
		padding: 8px 14px;
		border: none;
		background: none;
		color: var(--ink);
		text-align: left;
		font-size: 0.88rem;
		cursor: pointer;
	}

	.ctx-menu button:hover {
		background: var(--accent);
		color: var(--accent-ink, #fff);
	}

	.ctx-menu hr {
		border: none;
		border-top: 1px solid var(--rule);
		margin: 4px 0;
	}

	.ctx-danger {
		color: var(--danger, #c33) !important;
	}

	.ctx-danger:hover {
		background: var(--danger, #c33) !important;
		color: #fff !important;
	}
</style>
