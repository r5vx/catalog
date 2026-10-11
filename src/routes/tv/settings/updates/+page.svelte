<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	/**
	 * Updates on the TV: the Catalog the computer runs (the TV shows that one), whether a newer one
	 * is ready, and what changed in the last few. Installing it restarts Catalog on the computer;
	 * the TV picks it up again a minute later.
	 */
	let { data }: { data: PageData } = $props();

	type State = { status: string; version?: string; percent?: number };
	let progress = $state<State>({ status: 'idle' });
	let ready = $state<string | null>(null);
	let installing = $state(false);

	async function look() {
		try {
			const payload = await (await fetch('/api/update')).json();
			progress = payload.state ?? progress;
			ready = payload.state?.status === 'ready' ? (payload.state.version ?? null) : null;
		} catch {}
	}

	onMount(() => {
		look();
		const timer = setInterval(look, 4000);
		return () => clearInterval(timer);
	});

	async function check() {
		await fetch('/api/update?action=check', { method: 'POST' });
		look();
	}

	async function install() {
		installing = true;
		await fetch('/api/update?action=install', { method: 'POST' }).catch(() => {});
	}

	const status = $derived(
		installing
			? 'Installing on the computer… This TV reconnects in a minute.'
			: ready
				? `Catalog ${ready} is ready to install.`
				: progress.status === 'checking'
					? 'Checking…'
					: progress.status === 'downloading'
						? `Downloading Catalog ${progress.version ?? ''}${progress.percent ? ` (${progress.percent}%)` : ''}…`
						: progress.status === 'none'
							? 'This is the newest Catalog.'
							: progress.status === 'error'
								? "Couldn't check just now."
								: ''
	);

	const KIND_WORDS = { new: 'New', improved: 'Better', fixed: 'Fixed' } as const;
</script>

<svelte:head><title>Updates · Catalog</title></svelte:head>

<div class="updates">
	<h1>Updates</h1>
	<p class="current">Catalog {data.version} <span>on {data.computer}</span></p>
	{#if status}<p class="status">{status}</p>{/if}

	{#if data.mode === 'release'}
		<div class="buttons" data-tv-row>
			{#if ready}
				<button type="button" class="button primary" data-tv-item data-tv-autofocus disabled={installing} onclick={install}>
					Install Catalog {ready}
				</button>
			{:else}
				<button type="button" class="button" data-tv-item data-tv-autofocus onclick={check}>Check for updates</button>
			{/if}
		</div>
	{/if}

	<h2>What's new</h2>
	{#each data.releases as release (release.version)}
		<!-- Each one can be highlighted, so the arrows scroll down through them. -->
		<div class="release" data-tv-row>
			<div class="release-box" tabindex="-1" data-tv-item>
				<p class="release-head">
					<strong>{release.version}</strong>
					{#if release.title}· {release.title}{/if}
					{#if release.date}<span>{release.date}</span>{/if}
				</p>
				<ul>
					{#each release.changes as change, i (i)}
						{#each change.items as item, j (j)}
							<li><em>{KIND_WORDS[change.kind]}</em>{change.area ? ` ${change.area}:` : ''} {item}</li>
						{/each}
					{/each}
				</ul>
			</div>
		</div>
	{/each}
</div>

<style>
	.updates {
		position: absolute;
		inset: 0;
		overflow: hidden;
		padding: 7vh 4vw 30vh 1vw;
		display: flex;
		flex-direction: column;
		gap: 1.4vw;
	}

	h1 {
		margin: 0;
		font-family: var(--display);
		font-size: 3.2vw;
	}

	h2 {
		margin: 1.5vw 0 0;
		font-size: 1.8vw;
	}

	.current {
		margin: 0;
		font-size: 2vw;
		font-weight: 700;
	}

	.current span,
	.release-head span {
		color: var(--ink-soft);
		font-weight: 500;
	}

	.status {
		margin: 0;
		font-size: 1.5vw;
		color: var(--ink-soft);
	}

	.buttons {
		display: flex;
		gap: 1vw;
	}

	.button {
		padding: 1vw 2vw;
		border: none;
		border-radius: 0.6vw;
		background: rgb(255 255 255 / 14%);
		color: var(--ink);
		font: inherit;
		font-size: 1.6vw;
		font-weight: 700;
		cursor: pointer;
		outline: none;
	}

	.button:focus,
	.button:global(.tv-focused) {
		background: var(--ink);
		color: var(--paper);
	}

	.release-box {
		padding: 1.2vw 1.6vw;
		border-radius: 0.8vw;
		background: rgb(255 255 255 / 5%);
		outline: none;
		border: 0.2vw solid transparent;
	}

	.release-box:focus,
	.release-box:global(.tv-focused) {
		border-color: var(--ink);
	}

	.release-head {
		margin: 0 0 0.6vw;
		font-size: 1.6vw;
	}

	ul {
		margin: 0;
		padding-left: 1.4vw;
		display: flex;
		flex-direction: column;
		gap: 0.3vw;
		font-size: 1.3vw;
		color: var(--ink-soft);
	}

	em {
		font-style: normal;
		font-weight: 700;
		color: var(--ink);
	}
</style>
