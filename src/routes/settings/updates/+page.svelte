<script lang="ts">
	import { untrack } from 'svelte';
	import type { LayoutData } from '../$types';

	// Everything this page needs already comes from the settings layout.
	let { data }: { data: LayoutData } = $props();

	type RebuildState = {
		status: 'idle' | 'working' | 'swapping' | 'failed';
		percent: number;
		label: string;
		message?: string;
		startedAt?: number;
	};

	type ReleaseState = {
		status: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error';
		version?: string;
		percent?: number;
		message?: string;
	};

	let muted = $state(false);

	async function setMuted(next: boolean) {
		muted = next;
		await fetch(`/api/update?action=${next ? 'mute' : 'unmute'}`, { method: 'POST' });
	}

	let rebuild = $state<RebuildState>({ status: 'idle', percent: 0, label: '' });
	let release = $state<ReleaseState>({ status: 'idle' });

	/** Ticks while a rebuild runs, so the elapsed time is visibly moving. */
	let now = $state(Date.now());

	const busy = $derived(rebuild.status === 'working' || rebuild.status === 'swapping');

	const elapsed = $derived(
		rebuild.startedAt ? Math.max(0, Math.round((now - rebuild.startedAt) / 1000)) : 0
	);

	/* ------------------------------------------------------------- polling */

	// Both kinds of update report through the same endpoint, so one poll does.
	async function read() {
		try {
			const response = await fetch('/api/update');
			if (!response.ok) return;

			const payload = await response.json();
			release = payload.state;
			rebuild = payload.rebuild;
			muted = payload.muted ?? muted;
		} catch {
			// The app is closing for the swap. Leave the last state on screen.
		}
	}

	let polling = false;

	async function poll() {
		if (polling) return;
		polling = true;

		try {
			const until = Date.now() + 15 * 60_000;
			while (Date.now() < until) {
				await new Promise((resolve) => setTimeout(resolve, 900));
				now = Date.now();
				await read();

				if (rebuild.status === 'failed') break;
				if (rebuild.status === 'idle' && ['none', 'ready', 'error'].includes(release.status)) break;
			}
		} finally {
			polling = false;
		}
	}

	$effect(() => {
		untrack(() => {
			// A rebuild may already be running from before this page was opened.
			read().then(() => {
				if (busy || release.status === 'checking') poll();
			});
		});
	});

	/* --------------------------------------------- built from source: rebuild */

	async function startRebuild() {
		rebuild = { status: 'working', percent: 0, label: 'Starting…', startedAt: Date.now() };
		now = Date.now();

		try {
			const response = await fetch('/api/update', { method: 'POST' });
			if (!response.ok) {
				rebuild = { status: 'failed', percent: 0, label: '', message: 'Could not start.' };
				return;
			}
			poll();
		} catch {
			rebuild = { status: 'failed', percent: 0, label: '', message: 'Could not start.' };
		}
	}

	/* ------------------------------------------ installed copy: from a release */

	async function checkNow() {
		release = { status: 'checking' };
		await fetch('/api/update?action=check', { method: 'POST' });
		poll();
	}

	async function installNow() {
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

	const downloading = $derived(release.status === 'downloading');
</script>

<svelte:head><title>Updates · Catalog</title></svelte:head>

<div class="sections">
	<section>
		{#if data.updateMode === 'source'}
			{#if busy}
				<div class="progress" role="status" aria-live="polite">
					<div class="bar">
						<div
							class="fill"
							class:done={rebuild.status === 'swapping'}
							style="width: {Math.max(4, rebuild.percent)}%"
						></div>
					</div>
					<p class="step">
						<span>{rebuild.label}</span>
						<span class="faint tabular">{elapsed}s</span>
					</p>
					{#if rebuild.status === 'swapping'}
						<p class="faint hint">Catalog will close and reopen on its own.</p>
					{:else}
						<p class="faint hint">You can keep using Catalog while this runs.</p>
					{/if}
				</div>
			{:else}
				{#if rebuild.status === 'failed'}
					<p class="msg bad" role="alert">{rebuild.message}</p>
				{/if}

				<button type="button" class="btn btn-primary" onclick={startRebuild}>
					Update Catalog
				</button>
				<p class="faint hint">Takes a minute or two. Your library isn't touched.</p>
			{/if}
		{:else if data.updateMode === 'release'}
			{#if releaseNote}
				<p class="msg {release.status === 'error' ? 'bad' : 'good'}" role="status">{releaseNote}</p>
			{/if}

			{#if downloading}
				<div class="bar">
					<div class="fill" style="width: {Math.max(4, release.percent ?? 0)}%"></div>
				</div>
			{/if}

			{#if release.status === 'ready'}
				<button type="button" class="btn btn-primary" onclick={installNow}>
					Restart and install
				</button>
			{:else}
				<button
					type="button"
					class="btn"
					disabled={release.status === 'checking' || downloading}
					onclick={checkNow}
				>
					Check for updates
				</button>
			{/if}
		{:else}
			<p class="muted">Nothing to update here.</p>
		{/if}
	</section>

	{#if data.updateMode !== 'none'}
		<section>
			<label class="toggle">
				<input
					type="checkbox"
					checked={!muted}
					onchange={(e) => setMuted(!e.currentTarget.checked)}
				/>
				Tell me when an update is ready
			</label>
		</section>
	{/if}

	{#if data.releases.length > 0}
		<section class="changes">
			<div class="head"><h2>What's new</h2></div>

			{#each data.releases.slice(0, 6) as release (release.version)}
				<article>
					<h3>
						{release.version}
						{#if release.version === data.appVersion}<span class="pill completed">Yours</span>{/if}
						{#if release.date}<span class="when faint tabular">{release.date}</span>{/if}
					</h3>
					<ul>
						{#each release.bullets as bullet, index (index)}
							<li>
								{#each bullet as run, part (part)}
									{#if run.bold}<strong>{run.text}</strong>{:else}{run.text}{/if}
								{/each}
							</li>
						{/each}
					</ul>
				</article>
			{/each}
		</section>
	{/if}
</div>

<style>
	.sections {
		display: flex;
		flex-direction: column;
		gap: 38px;
	}

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

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 0.9rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.toggle input {
		width: auto;
	}

	/* ------------------------------------------------------- the progress */

	.progress {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.bar {
		width: 100%;
		height: 8px;
		background: var(--sunk);
		border-radius: 100px;
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: var(--accent);
		border-radius: 100px;
		transition: width 0.4s ease;
	}

	.fill.done {
		background: var(--good);
	}

	.step {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin: 0;
		font-size: 0.92rem;
		font-weight: 600;
	}

	/* --------------------------------------------------------- what's new */

	.changes {
		width: 100%;
		gap: 0;
	}

	.head {
		width: 100%;
		border-bottom: 1px solid var(--rule);
		padding-bottom: 8px;
		margin-bottom: 4px;
	}

	h2 {
		font-size: 1.1rem;
	}

	.changes article {
		width: 100%;
		padding: 16px 0;
		border-bottom: 1px solid var(--rule);
	}

	.changes article:last-child {
		border-bottom: none;
	}

	h3 {
		font-family: var(--body);
		font-size: 0.95rem;
		font-weight: 700;
		margin: 0 0 6px;
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.when {
		font-size: 0.78rem;
		font-weight: 400;
	}

	.changes ul {
		margin: 0;
		padding-left: 1.1em;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.changes li {
		font-size: 0.9rem;
		line-height: 1.55;
		color: var(--ink-soft);
	}
</style>
