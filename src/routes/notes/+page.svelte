<script lang="ts">
	import MoreButton from '$lib/MoreButton.svelte';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import CategoryTabs from '$lib/CategoryTabs.svelte';
	import LibraryHeader from '$lib/LibraryHeader.svelte';
	import NotesTabs from '$lib/NotesTabs.svelte';
	import { askText } from '$lib/confirm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const pm = $derived(page.data.poisonMode);

	/** Looking at one tag's pages: /notes?tag=3. */
	const activeTag = $derived(Number(page.url.searchParams.get('tag')) || null);
	const tagName = (id: number) => data.tags.find((t) => t.id === id)?.name ?? '';

	let query = $state('');
	const words = $derived(query.toLowerCase().split(/\s+/).filter(Boolean));

	const inTag = $derived(activeTag ? data.notes.filter((note) => note.tagIds.includes(activeTag)) : data.notes);

	// Every word has to appear somewhere — the same rule as the library search.
	const shown = $derived(
		words.length === 0
			? inTag
			: inTag.filter((note) => {
					const haystack = `${note.title} ${note.text}`.toLowerCase();
					return words.every((w) => haystack.includes(w));
				})
	);

	/** The bit of the note around the first match, so you can see why it came up. */
	function snippet(text: string) {
		const lower = text.toLowerCase();
		for (const w of words) {
			const i = lower.indexOf(w);
			if (i < 0) continue;
			const start = Math.max(0, i - 40);
			return {
				before: (start > 0 ? '…' : '') + text.slice(start, i),
				match: text.slice(i, i + w.length),
				after: text.slice(i + w.length, i + w.length + 200)
			};
		}
		return null;
	}

	const when = (iso: string) =>
		new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

	/* ------------------------------------------------ sorting (remembered) */

	async function setSort(sort: string) {
		await fetch('/api/notes/tags', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sort })
		});
		invalidateAll();
	}

	/* ------------------------------------------------ right-click menu */

	type Note = (typeof data.notes)[number];
	let menu = $state<{ x: number; y: number; note: Note } | null>(null);
	let problem = $state('');

	function openMenu(e: MouseEvent, note: Note) {
		e.preventDefault();
		menu = { x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 320), note };
	}

	async function patch(body: Record<string, unknown>) {
		menu = null;
		problem = '';
		const response = await fetch('/api/notes', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!response.ok) problem = "That didn't work. Try again.";
		await invalidateAll();
	}

	const pin = (note: Note) => patch({ id: note.id, action: 'pin', pinned: !note.pinned });
	const toggleTag = (note: Note, tagId: number) =>
		patch({ id: note.id, action: 'tag', tagId, on: !note.tagIds.includes(tagId) });

	async function newTag(note: Note) {
		menu = null;
		const name = await askText({ title: 'New tag', placeholder: 'Tag name', confirmLabel: 'Add tag' });
		if (name) patch({ id: note.id, action: 'tag', tagName: name, on: true });
	}

	async function remove(note: Note) {
		menu = null;
		problem = '';
		const response = await fetch('/api/notes', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: note.id })
		});
		if (response.status === 403) problem = `"${note.title}" is locked. Open it and enter your PIN to delete it.`;
		await invalidateAll();
	}
</script>

<svelte:head><title>{pm ? "Papa's notes" : 'Notes'} · {pm ? "Papa's back" : 'Catalog'}</title></svelte:head>

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

{#if data.deletedCount > 0 || data.tags.length > 0}
	<NotesTabs pageCount={data.notes.length} deletedCount={data.deletedCount} tags={data.tags} active={activeTag ?? 'pages'} />
{/if}

{#snippet newPage()}
	<form method="POST" action="?/create">
		{#if activeTag}<input type="hidden" name="tag" value={activeTag} />{/if}
		<button type="submit" class="btn btn-primary">+ New page</button>
	</form>
{/snippet}

{#if data.notes.length === 0}
	<div class="empty">
		<h2>No pages yet</h2>
		<p class="muted">Anything you want to keep that isn't a movie.</p>
		{@render newPage()}
	</div>
{:else}
	<div class="toolbar">
		<input
			type="search"
			placeholder={pm ? 'find a note...' : 'Search notes…'}
			aria-label="Search notes"
			bind:value={query}
		/>
		<select aria-label="Sort notes" value={data.sort} onchange={(e) => setSort(e.currentTarget.value)}>
			<option value="updated">Last edited</option>
			<option value="created">Date created</option>
			<option value="title">Name A–Z</option>
		</select>
		{@render newPage()}
	</div>
	<p class="muted count tabular">
		{words.length ? `${shown.length} of ` : ''}{inTag.length}
		{inTag.length === 1 ? 'page' : 'pages'}{activeTag ? ` tagged ${tagName(activeTag)}` : ''}
	</p>
	{#if problem}<p class="msg bad" role="alert">{problem}</p>{/if}

	{#if shown.length === 0}
		<p class="muted no-match">
			{words.length ? `No notes match “${query.trim()}”.` : 'No pages have this tag yet. Right-click a page to tag it.'}
		</p>
	{:else}
		<ul class="pages">
			{#each shown as note (note.id)}
				{@const hit = words.length && !note.locked ? snippet(note.text) : null}
				<li class="has-more" oncontextmenu={(e) => openMenu(e, note)}>
					<a href="/notes/{note.id}" class:locked={note.locked}>
						<span class="top">
							<span class="name">
								{#if note.pinned}<span class="pin" title="Pinned" aria-label="Pinned">📌</span>{/if}
								{#if note.locked}<span class="padlock" aria-label="Locked">🔒</span>{/if}
								{note.title}
								{#each note.tagIds as tagId (tagId)}
									<span class="tag-chip">{tagName(tagId)}</span>
								{/each}
							</span>
							<span class="when faint tabular">
								{data.sort === 'created' ? `Created ${when(note.createdAt)}` : `Edited ${when(note.updatedAt)}`}
							</span>
						</span>
						<span class="preview faint">
							{#if note.locked}
								Locked
							{:else if hit}
								{hit.before}<mark>{hit.match}</mark>{hit.after}
							{:else}
								{note.text.slice(0, 300) || 'Empty'}
							{/if}
						</span>
					</a>
					<MoreButton variant="inline" onopen={(e) => openMenu(e, note)} />
				</li>
			{/each}
		</ul>
	{/if}
{/if}

{#if menu}
	{@const note = menu.note}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="ctx-backdrop" onclick={() => (menu = null)} oncontextmenu={(e) => { e.preventDefault(); menu = null; }}></div>
	<div class="ctx-menu" style="left: {menu.x}px; top: {menu.y}px;">
		<a href="/notes/{note.id}" onclick={() => (menu = null)}>Open</a>
		<button type="button" onclick={() => pin(note)}>{note.pinned ? 'Unpin' : '📌 Pin to top'}</button>
		<hr />
		<span class="ctx-label">Tags</span>
		{#each data.tags as tag (tag.id)}
			<button type="button" class="ctx-tag" onclick={() => toggleTag(note, tag.id)}>
				<span class="check" aria-hidden="true">{note.tagIds.includes(tag.id) ? '✓' : ''}</span>{tag.name}
			</button>
		{/each}
		<button type="button" class="ctx-tag" onclick={() => newTag(note)}><span class="check" aria-hidden="true">+</span>New tag…</button>
		<hr />
		<button type="button" class="ctx-danger" onclick={() => remove(note)}>Delete</button>
	</div>
{/if}

<style>
	.padlock {
		font-size: 0.8em;
		margin-right: 3px;
	}

	.locked .preview {
		font-style: italic;
	}

	.toolbar {
		display: flex;
		gap: 10px;
		margin-bottom: 10px;
	}

	.toolbar input {
		flex: 1;
		min-width: 0;
	}

	.toolbar select {
		width: auto;
		min-width: 140px;
	}

	.pin {
		font-size: 0.8em;
		margin-right: 3px;
	}

	.tag-chip {
		display: inline-block;
		margin-left: 6px;
		padding: 1px 8px;
		border-radius: 100px;
		background: var(--surface-2);
		color: var(--ink-soft);
		font-size: 0.72rem;
		font-weight: 600;
		vertical-align: 2px;
	}

	.ctx-backdrop {
		position: fixed;
		inset: 0;
		z-index: 900;
	}

	.ctx-menu {
		position: fixed;
		z-index: 901;
		min-width: 200px;
		max-height: 70vh;
		overflow-y: auto;
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

	.ctx-label {
		display: block;
		padding: 4px 14px 2px;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.check {
		display: inline-block;
		width: 1.3em;
	}

	.ctx-danger {
		color: var(--danger, #c33) !important;
	}

	.ctx-danger:hover {
		background: var(--danger, #c33) !important;
		color: #fff !important;
	}

	@media (max-width: 560px) {
		.toolbar {
			flex-wrap: wrap;
		}

		.toolbar input {
			flex-basis: 100%;
		}

		.toolbar select {
			flex: 1;
		}
	}

	.no-match {
		padding: 24px 4px;
	}

	mark {
		background: var(--accent-bg);
		color: inherit;
		border-radius: 2px;
		padding: 0 1px;
	}

	.count {
		font-size: 0.82rem;
		margin: 0 0 8px;
	}

	.pages {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--rule);
	}

	.pages li {
		display: flex;
		align-items: center;
		gap: 4px;
		border-bottom: 1px solid var(--rule);
	}

	.pages a {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 14px 4px;
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
