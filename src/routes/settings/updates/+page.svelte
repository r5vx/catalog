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
	let isMac = $state(false);
	let quarantineStatus = $state<'idle' | 'done' | 'error'>('idle');

	async function setMuted(next: boolean) {
		muted = next;
		await fetch(`/api/update?action=${next ? 'mute' : 'unmute'}`, { method: 'POST' });
	}

	async function fixQuarantine() {
		try {
			const resp = await fetch('/api/update?action=fix-quarantine', { method: 'POST' });
			const data = await resp.json();
			quarantineStatus = data.ok ? 'done' : 'error';
		} catch {
			quarantineStatus = 'error';
		}
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
			isMac = payload.isMac ?? false;
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
				return (release.percent ?? 0) > 0
					? `Downloading ${release.version ?? 'the update'} — ${release.percent}%`
					: `Downloading ${release.version ?? 'the update'}…`;
			case 'ready':
				return `Version ${release.version} is ready to install.`;
			case 'none':
				return 'You have the latest version.';
			case 'error':
				if (release.message?.includes('latest-mac.yml'))
					return 'Auto-updates are not available on Mac. Download new versions from the GitHub release page.';
				return `Could not check for updates.`;
			default:
				return '';
		}
	});

	const downloading = $derived(release.status === 'downloading');

	const TAG = { new: 'New', improved: 'Improved', fixed: 'Fixed' } as const;

	let expandedVersions = $state<Set<string>>(new Set());

	function toggleVersion(version: string) {
		const next = new Set(expandedVersions);
		if (next.has(version)) next.delete(version);
		else next.add(version);
		expandedVersions = next;
	}

	function isOpen(version: string, index: number): boolean {
		if (expandedVersions.has(version)) return true;
		return index < 3 && !expandedVersions.has(version + '__closed');
	}

	function toggle(version: string, index: number) {
		const next = new Set(expandedVersions);
		if (isOpen(version, index)) {
			next.delete(version);
			if (index < 3) next.add(version + '__closed');
		} else {
			next.add(version);
			next.delete(version + '__closed');
		}
		expandedVersions = next;
	}
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
					<div class="fill" class:indeterminate={(release.percent ?? 0) === 0} style="width: {Math.max(4, release.percent ?? 0)}%"></div>
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

	{#if isMac}
		<section>
			<h3 class="mac-heading">Mac</h3>
			<p class="faint hint">If macOS blocks Catalog after an update, click below to fix it.</p>
			{#if quarantineStatus === 'done'}
				<p class="msg good">Done — Catalog will open normally now.</p>
			{:else if quarantineStatus === 'error'}
				<p class="msg bad">Could not fix automatically. Open Terminal and run: <code>xattr -cr /Applications/Catalog.app</code></p>
			{:else}
				<button type="button" class="btn" onclick={fixQuarantine}>Fix Mac quarantine</button>
			{/if}
		</section>
	{/if}

	{#if data.releases.length > 0}
		<section class="changes">
			<div class="head"><h2>What's new</h2></div>

			{#each data.releases as rel, i (rel.version)}
				{@const open = isOpen(rel.version, i)}
				<article class="release" class:collapsed={!open}>
					<button class="release-toggle" onclick={() => toggle(rel.version, i)}>
						<svg class="chevron" class:open viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
						<span class="release-title">
							<span class="version">{rel.version === 'Unreleased' ? 'Coming next' : `Version ${rel.version}`}</span>
							{#if rel.title}<span class="release-subtitle">{rel.title}</span>{/if}
							{#if rel.version === data.appVersion}<span class="pill completed">Yours</span>{/if}
						</span>
						{#if rel.date}<span class="when faint tabular">{rel.date}</span>{/if}
					</button>
					{#if open}
						<ul class="change-list">
							{#each rel.changes as change, index (index)}
								<li class="change">
									<span class="tag tag-{change.kind}">{TAG[change.kind]}</span>
									{#if change.area}
										<div class="change-body">
											<span class="area">{change.area}</span>
											<ul class="area-items">
												{#each change.items as item, n (n)}<li>{item}</li>{/each}
											</ul>
										</div>
									{:else}
										<span class="change-body">{change.items[0]}</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
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

	.mac-heading {
		font-size: 1rem;
		margin: 0;
	}

	code {
		font-family: var(--mono);
		font-size: 0.82em;
		background: var(--sunk);
		padding: 2px 5px;
		border-radius: 3px;
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

	.fill.indeterminate {
		width: 30% !important;
		animation: indeterminate 1.5s ease-in-out infinite;
	}

	@keyframes indeterminate {
		0% { margin-left: 0; }
		50% { margin-left: 70%; }
		100% { margin-left: 0; }
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

	.changes {
		gap: 12px;
	}

	.release {
		width: 100%;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		padding: 0 16px;
	}

	.release.collapsed .release-toggle {
		padding-bottom: 12px;
	}

	.release-toggle {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 0 10px;
		background: none;
		border: none;
		cursor: pointer;
		color: inherit;
		font: inherit;
		text-align: left;
	}

	.release-toggle:hover {
		opacity: 0.8;
	}

	.chevron {
		flex: none;
		align-self: flex-start;
		margin-top: 4px;
		transition: transform 0.2s ease;
		transform: rotate(-90deg);
		opacity: 0.5;
	}

	.chevron.open {
		transform: rotate(0deg);
	}

	.release-title {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 4px 10px;
	}

	.version {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--accent);
	}

	.release-subtitle {
		font-weight: 500;
		color: var(--ink-soft);
		font-size: 0.88rem;
	}

	.when {
		font-size: 0.78rem;
		font-weight: 400;
		margin-left: auto;
		white-space: nowrap;
		align-self: flex-start;
		padding-top: 4px;
	}

	/* One row per change: its tag, then what changed. */
	.change-list {
		list-style: none;
		margin: 0;
		padding: 2px 0 14px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.change {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		font-size: 0.9rem;
		line-height: 1.45;
		color: var(--ink);
	}

	.tag {
		flex: none;
		width: 74px;
		text-align: center;
		padding: 2px 0;
		border-radius: var(--radius-sm);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--surface);
		margin-top: 1px;
	}

	.tag-new {
		background: var(--good);
	}

	.tag-improved {
		background: var(--warn);
	}

	.tag-fixed {
		background: var(--accent);
	}

	.change-body {
		min-width: 0;
	}

	.area {
		font-weight: 600;
	}

	.area-items {
		margin: 3px 0 0;
		padding-left: 1.1em;
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: var(--ink-soft);
	}
</style>
