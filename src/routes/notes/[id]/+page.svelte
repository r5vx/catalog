<script lang="ts">
	import { goto } from '$app/navigation';
	import NoteEditor from '$lib/NoteEditor.svelte';
	import NoteView from '$lib/NoteView.svelte';
	import { confirmAction } from '$lib/confirm.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	async function save(title: string, body: string) {
		const response = await fetch('/api/notes', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: data.note.id, title, body })
		});
		if (!response.ok) throw new Error('save failed');
	}

	function saveNow(title: string, body: string, unloading: boolean) {
		const payload = JSON.stringify({ id: data.note.id, title, body });
		if (unloading) {
			fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true });
			return;
		}
		// Synchronous on purpose: the notes list loads next and has to see this save.
		const xhr = new XMLHttpRequest();
		xhr.open('POST', '/api/notes', false);
		xhr.setRequestHeader('Content-Type', 'application/json');
		try { xhr.send(payload); } catch {}
	}

	const when = (iso: string) =>
		new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

	// No "are you sure": it goes to Recently deleted, where it can be brought back for a week.
	async function remove() {
		await fetch('/api/notes', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: data.note.id })
		});
		goto('/notes', { invalidateAll: true });
	}

	let problem = $state('');

	async function act(action: 'restore' | 'erase') {
		if (
			action === 'erase' &&
			!(await confirmAction({ title: `Delete "${data.note.title}" for good?`, message: "This can't be undone.", confirmLabel: 'Delete forever' }))
		)
			return;
		const response = await fetch('/api/notes', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: data.note.id, action })
		});
		if (!response.ok) {
			problem = "That didn't work. Try again.";
			return;
		}
		if (action === 'erase') goto('/notes/deleted', { invalidateAll: true });
		else goto(`/notes/${data.note.id}`, { invalidateAll: true });
	}
</script>

<svelte:head><title>{data.note.title} · Catalog</title></svelte:head>

<a href="/notes" class="back faint">&larr; Notes</a>

{#if data.locked}
	<div class="gate">
		<span class="padlock" aria-hidden="true">🔒</span>
		<h1>{data.note.title}</h1>
		<p class="muted">Locked. Enter your PIN to read it.</p>

		{#if form?.pinError}
			<p class="msg bad" role="alert">{form.pinError}</p>
		{/if}

		<form method="POST" action="?/unlock" class="pin-form">
			<!-- svelte-ignore a11y_autofocus -->
			<input
				type="password"
				name="pin"
				placeholder="PIN"
				autocomplete="off"
				aria-label="PIN"
				autofocus
			/>
			<button type="submit" class="btn btn-primary">Unlock</button>
		</form>
	</div>
{:else}
	{#if form?.lockError}
		<p class="msg bad" role="alert">{form.lockError}</p>
	{/if}

	<p class="dates faint tabular">
		Created {when(data.note.createdAt)} · Last edited {when(data.note.updatedAt)}
	</p>

	{#if data.note.deletedAt}
		<div class="deleted-bar">
			<span>In Recently deleted — deleted for good on {when(data.erasedOn ?? data.note.deletedAt)}.</span>
			<div class="deleted-actions">
				<button type="button" class="btn btn-primary" onclick={() => act('restore')}>Restore</button>
				<button type="button" class="btn btn-danger" onclick={() => act('erase')}>Delete forever</button>
			</div>
		</div>
		{#if problem}<p class="msg bad" role="alert">{problem}</p>{/if}
		<NoteView title={data.note.title} body={data.note.body} />
	{:else}
		<NoteEditor initialTitle={data.note.title} initialBody={data.note.body} onsave={save} onleave={saveNow} />

		<div class="tools">
			{#if data.note.locked}
				<div class="locked-row">
					<span class="muted">🔒 Locked — the PIN is needed to open this page.</span>
					<form method="POST" action="?/unlockPermanently">
						<button type="submit" class="btn">Remove the lock</button>
					</form>
				</div>
				<form method="POST" action="?/forget">
					<button type="submit" class="btn btn-quiet">Lock again now</button>
				</form>
			{:else if data.pinSet}
				<form method="POST" action="?/lock">
					<button type="submit" class="btn">🔒 Lock this page</button>
				</form>
			{:else}
				<p class="faint hint">
					<a href="/settings/privacy">Set a PIN</a> if you want to lock pages.
				</p>
			{/if}

			<a href="/notes/{data.note.id}/history" class="btn">
				🕘 Version history{data.versionCount ? ` (${data.versionCount})` : ''}
			</a>

			<button type="button" class="btn btn-danger" onclick={remove}>Delete this page</button>
		</div>
	{/if}
{/if}

<style>
	.back {
		font-size: 0.85rem;
		display: inline-block;
		margin-bottom: 10px;
	}

	.deleted-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 10px 16px;
		margin-bottom: 14px;
		padding: 12px 14px;
		background: var(--warn-bg);
		border: 1px solid var(--warn);
		border-radius: var(--radius);
		color: var(--warn);
		font-weight: 600;
		font-size: 0.9rem;
	}

	.deleted-actions {
		display: flex;
		gap: 8px;
	}

	.dates {
		font-size: 0.78rem;
		margin: 0 0 8px;
	}

	.back:hover {
		color: var(--accent);
	}

	/* ---------------------------------------------------------- the lock */

	.gate {
		max-width: 38ch;
		margin: 10vh auto 0;
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: center;
	}

	.padlock {
		font-size: 2.2rem;
		line-height: 1;
	}

	.gate h1 {
		font-size: 1.5rem;
	}

	.gate .muted {
		margin: 0;
		font-size: 0.92rem;
	}

	.pin-form {
		display: flex;
		gap: 8px;
		margin-top: 6px;
		width: 100%;
	}

	.pin-form input {
		flex: 1;
		min-width: 0;
		text-align: center;
	}

	.msg {
		border-radius: var(--radius-sm);
		padding: 9px 13px;
		margin: 0;
		font-size: 0.89rem;
		width: 100%;
	}

	.bad {
		background: var(--accent-bg);
		border: 1px solid var(--accent);
		color: var(--accent);
	}

	/* --------------------------------------------------------- the tools */

	.tools {
		margin-top: 40px;
		padding-top: 20px;
		border-top: 1px solid var(--rule);
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: flex-start;
	}

	.locked-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		padding: 10px 14px;
	}

	.locked-row .muted {
		font-size: 0.9rem;
	}

	.btn-quiet {
		border-color: transparent;
		background: transparent;
		color: var(--ink-faint);
		padding-left: 0;
	}

	.btn-quiet:hover {
		background: transparent;
		color: var(--ink);
	}

	.hint {
		font-size: 0.85rem;
		margin: 0;
	}

	.hint a {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
</style>
