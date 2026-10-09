<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import CategoryTabs from '$lib/CategoryTabs.svelte';
	import LibraryHeader from '$lib/LibraryHeader.svelte';
	import NotesTabs from '$lib/NotesTabs.svelte';
	import { confirmAction } from '$lib/confirm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const pm = $derived(page.data.poisonMode);

	/** Gone from this list straight away, before the page reloads. */
	let done = $state<number[]>([]);
	const notes = $derived(data.deleted.filter((n) => !done.includes(n.id)));
	let problem = $state('');

	const when = (iso: string) =>
		new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

	function daysLeft(deletedAt: string) {
		const left = Math.ceil((Date.parse(deletedAt) + data.keepDays * 86_400_000 - Date.now()) / 86_400_000);
		return left <= 1 ? 'Deleted for good tomorrow' : `${left} days left`;
	}

	async function act(id: number, action: 'restore' | 'erase') {
		problem = '';
		const response = await fetch('/api/notes', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id, action })
		});
		if (!response.ok) {
			problem = response.status === 403 ? 'That page is locked. Open it and enter your PIN first.' : "That didn't work. Try again.";
			return;
		}
		done = [...done, id];
		invalidateAll();
	}

	async function eraseOne(note: { id: number; title: string }) {
		const yes = await confirmAction({ title: `Delete "${note.title}" for good?`, message: "This can't be undone.", confirmLabel: 'Delete forever' });
		if (yes) act(note.id, 'erase');
	}

	let menu = $state<{ x: number; y: number; note: (typeof data.deleted)[number] } | null>(null);

	function openMenu(e: MouseEvent, note: (typeof data.deleted)[number]) {
		e.preventDefault();
		menu = { x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 140), note };
	}

	async function eraseAll() {
		const count = notes.length;
		const yes = await confirmAction({
			title: `Delete ${count === 1 ? 'this page' : `all ${count} pages`} for good?`,
			message: "This can't be undone.",
			confirmLabel: 'Delete forever'
		});
		if (!yes) return;
		for (const note of notes) await act(note.id, 'erase');
	}
</script>

<svelte:head><title>Recently deleted · Notes · Catalog</title></svelte:head>

<LibraryHeader
	categories={data.categories}
	countByCategory={data.countByCategory}
	total={data.total}
	completed={data.completed}
	completedByCategory={data.completedByCategory}
	poisonMode={pm}
/>

<CategoryTabs
	categories={data.categories}
	countByCategory={data.countByCategory}
	total={data.total}
	noteCount={data.noteCount}
	watchingCount={data.watchingCount}
	friendCount={data.friendCount}
	active="notes"
	poisonMode={pm}
/>

<NotesTabs pageCount={data.pageCount} deletedCount={notes.length} tags={data.tags} active="deleted" />

{#if problem}<p class="msg bad" role="alert">{problem}</p>{/if}

{#if notes.length === 0}
	<div class="empty">
		<h2>Nothing in Recently deleted</h2>
		<p class="muted">Deleted pages wait here for {data.keepDays} days before they're gone for good.</p>
		<a href="/notes" class="btn">Back to notes</a>
	</div>
{:else}
	<div class="intro">
		<p class="muted small">Pages are deleted for good {data.keepDays} days after you delete them.</p>
		<button type="button" class="btn btn-danger" onclick={eraseAll}>Delete all for good</button>
	</div>

	<ul class="pages">
		{#each notes as note (note.id)}
			<li oncontextmenu={(e) => openMenu(e, note)}>
				<a href="/notes/{note.id}" class="open" class:locked={note.locked}>
					<span class="name">
						{#if note.locked}<span class="padlock" aria-label="Locked">🔒</span>{/if}
						{note.title}
					</span>
					<span class="when faint tabular">Deleted {when(note.deletedAt)} · {daysLeft(note.deletedAt)}</span>
					<span class="preview faint">{note.locked ? 'Locked' : note.text.slice(0, 300) || 'Empty'}</span>
				</a>
				<div class="actions">
					<button type="button" class="btn" onclick={() => act(note.id, 'restore')}>Restore</button>
					<button type="button" class="btn btn-danger" onclick={() => eraseOne(note)}>Delete forever</button>
				</div>
			</li>
		{/each}
	</ul>
{/if}

{#if menu}
	{@const note = menu.note}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="ctx-backdrop" onclick={() => (menu = null)} oncontextmenu={(e) => { e.preventDefault(); menu = null; }}></div>
	<div class="ctx-menu" style="left: {menu.x}px; top: {menu.y}px;">
		<a href="/notes/{note.id}" onclick={() => (menu = null)}>Open</a>
		<button type="button" onclick={() => { menu = null; act(note.id, 'restore'); }}>Restore</button>
		<hr />
		<button type="button" class="ctx-danger" onclick={() => { menu = null; eraseOne(note); }}>Delete forever</button>
	</div>
{/if}

<style>
	.ctx-backdrop {
		position: fixed;
		inset: 0;
		z-index: 900;
	}

	.ctx-menu {
		position: fixed;
		z-index: 901;
		min-width: 180px;
		padding: 4px 0;
		background: var(--surface);
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}

	.ctx-menu button,
	.ctx-menu a {
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

	.ctx-menu button:hover,
	.ctx-menu a:hover {
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

	.small {
		font-size: 0.85rem;
		margin: 0;
	}

	.intro {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 10px;
		margin-bottom: 12px;
	}

	.pages {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: 1px solid var(--rule);
	}

	.pages li {
		display: flex;
		align-items: center;
		gap: 12px;
		border-bottom: 1px solid var(--rule);
	}

	.open {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 14px 4px;
	}

	.open:hover {
		background: var(--surface);
	}

	.name {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.padlock {
		font-size: 0.8em;
		margin-right: 3px;
	}

	.when {
		font-size: 0.78rem;
	}

	.preview {
		font-size: 0.85rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.locked .preview {
		font-style: italic;
	}

	.actions {
		display: flex;
		gap: 6px;
		flex: none;
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

	@media (max-width: 560px) {
		.pages li {
			flex-direction: column;
			align-items: stretch;
			gap: 0;
			padding-bottom: 12px;
		}
	}
</style>
