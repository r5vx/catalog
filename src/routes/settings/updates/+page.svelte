<script lang="ts">
	import { untrack } from 'svelte';
	import type { LayoutData } from '../$types';

	// Everything this page needs already comes from the settings layout.
	let { data }: { data: LayoutData } = $props();

	/* ---------------------------------------------- built from source: rebuild */

	let updating = $state(false);
	let updateNote = $state('');

	async function rebuild() {
		if (!confirm('Catalog will close, rebuild, and reopen. Continue?')) return;

		updating = true;
		updateNote = 'Starting the updater…';

		try {
			const response = await fetch('/api/update', { method: 'POST' });
			if (!response.ok) {
				updating = false;
				updateNote = 'Could not start the updater.';
				return;
			}
			updateNote = 'Catalog is closing. It will reopen when the update finishes.';
		} catch {
			updating = false;
			updateNote = 'Could not start the updater.';
		}
	}

	/* ------------------------------------------ installed copy: from a release */

	type UpdateState = {
		status: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error';
		version?: string;
		percent?: number;
		message?: string;
	};

	let release = $state<UpdateState>({ status: 'idle' });

	// Progress lives in the Electron process, so the page asks the server for
	// it rather than being told.
	async function readRelease() {
		try {
			const response = await fetch('/api/update');
			if (response.ok) release = (await response.json()).state;
		} catch {
			// Offline, or the app is closing. Leave the last state alone.
		}
	}

	const SETTLED = ['none', 'ready', 'error'];
	let polling = false;

	async function pollRelease() {
		if (polling) return;
		polling = true;

		try {
			const until = Date.now() + 120_000;
			while (Date.now() < until) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				await readRelease();
				if (SETTLED.includes(release.status)) break;
			}
		} finally {
			polling = false;
		}
	}

	$effect(() => {
		// A check also runs when the app opens, so there may already be an
		// answer waiting before anyone presses anything.
		if (untrack(() => data.updateMode) === 'release') readRelease();
	});

	async function checkNow() {
		release = { status: 'checking' };
		await fetch('/api/update?action=check', { method: 'POST' });
		pollRelease();
	}

	async function installNow() {
		if (!confirm('Catalog will close, update, and reopen. Continue?')) return;
		release = { status: 'downloading', percent: 100, version: release.version };
		await fetch('/api/update?action=install', { method: 'POST' });
	}

	const releaseNote = $derived.by(() => {
		switch (release.status) {
			case 'checking':
				return 'Checking…';
			case 'downloading':
				return `Downloading ${release.version ?? 'the update'} — ${release.percent ?? 0}%`;
			case 'ready':
				return `Version ${release.version} is ready to install.`;
			case 'none':
				return 'You have the latest version.';
			case 'error':
				return `Could not check: ${release.message}`;
			default:
				return '';
		}
	});
</script>

<svelte:head><title>Updates · Catalog</title></svelte:head>

{#if data.updateMode === 'source'}
	<section>
		{#if updateNote}
			<p class="msg good" role="status">{updateNote}</p>
		{/if}

		<div>
			<button type="button" class="btn" disabled={updating} onclick={rebuild}>
				{updating ? 'Updating…' : 'Update Catalog'}
			</button>
		</div>

		<p class="faint hint">Takes about a minute. Your library isn't touched.</p>
	</section>
{:else if data.updateMode === 'release'}
	<section>
		{#if releaseNote}
			<p class="msg {release.status === 'error' ? 'bad' : 'good'}" role="status">{releaseNote}</p>
		{/if}

		<div>
			{#if release.status === 'ready'}
				<button type="button" class="btn btn-primary" onclick={installNow}>
					Restart and install
				</button>
			{:else}
				<button
					type="button"
					class="btn"
					disabled={release.status === 'checking' || release.status === 'downloading'}
					onclick={checkNow}
				>
					Check for updates
				</button>
			{/if}
		</div>
	</section>
{:else}
	<p class="muted">Nothing to update here.</p>
{/if}

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: flex-start;
	}

	.muted {
		font-size: 0.93rem;
		margin: 0;
	}

	.msg {
		border-radius: var(--radius-sm);
		padding: 9px 13px;
		margin: 0;
		font-size: 0.89rem;
	}

	.bad {
		background: var(--accent-bg);
		border: 1px solid var(--accent);
		color: var(--accent);
	}

	.good {
		background: var(--good-bg);
		border: 1px solid var(--good);
		color: var(--good);
	}

	.hint {
		font-size: 0.8rem;
		margin: 0;
	}
</style>
