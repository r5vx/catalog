<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { tick } from 'svelte';
	import { tvFocus, startTvNav } from '$lib/tvNav';
	import type { TileMenu } from './tiles';

	/**
	 * The remote's menu button (☰) on a poster: what can be done with it, in a small list over the
	 * screen — mark it watched, take it off Continue Watching, put it on My List. Up and down move,
	 * OK does it, Back closes the list. The rest of the screen can't be reached meanwhile.
	 */
	let { showing = $bindable(false) }: { showing?: boolean } = $props();

	type Action = { label: string; run: () => Promise<unknown> };
	let menu = $state<{ title: string; actions: Action[]; from: HTMLElement } | null>(null);
	let busy = $state(false);
	let list: HTMLElement | undefined = $state();

	$effect(() => {
		showing = Boolean(menu);
	});

	// The menu button (src/lib/tv.ts, or ☰/M when trying it on a computer) and Back (tvBack).
	$effect(() => {
		const opened = () => openFor();
		const closed = () => close();
		window.addEventListener('catalog:tv-menu', opened);
		window.addEventListener('catalog:tv-menu-close', closed);
		return () => {
			window.removeEventListener('catalog:tv-menu', opened);
			window.removeEventListener('catalog:tv-menu-close', closed);
		};
	});

	const send = (url: string, body: unknown, method = 'POST') =>
		fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	const offContinue = (title: string, type: string) =>
		fetch(`/api/watch/progress?title=${encodeURIComponent(title)}&type=${type}&hide=1`, { method: 'DELETE' });

	function actionsFor(what: TileMenu): Action[] {
		if (what.kind === 'continue') {
			return [
				{
					label: 'Mark as watched',
					run: async () => {
						if (what.entryId) await send('/api/entries', { id: what.entryId, action: 'complete' }, 'PATCH');
						else if (what.link) await send('/api/add', { source: what.link.source, sourceId: what.link.id, status: 'completed' });
						await offContinue(what.title, what.type);
					}
				},
				{ label: 'Remove from Continue Watching', run: () => offContinue(what.title, what.type) }
			];
		}
		if (what.kind === 'library') {
			const actions: Action[] = [];
			if (what.status !== 'completed') {
				actions.push({ label: 'Mark as watched', run: () => send('/api/entries', { id: what.id, action: 'complete' }, 'PATCH') });
			}
			actions.push({ label: 'Remove from My Library', run: () => send('/api/entries', { id: what.id }, 'DELETE') });
			return actions;
		}
		return [
			{ label: 'Add to My List', run: () => send('/api/add', { source: what.source, sourceId: what.sourceId, status: 'planned' }) },
			{ label: 'Mark as watched', run: () => send('/api/add', { source: what.source, sourceId: what.sourceId, status: 'completed' }) }
		];
	}

	async function openFor() {
		const from = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-tv-menu]');
		if (!from || menu) return;
		let what: TileMenu;
		try {
			what = JSON.parse(from.dataset.tvMenu ?? '');
		} catch {
			return;
		}
		const actions = actionsFor(what);
		if (!actions.length) return;
		menu = { title: from.dataset.tvTitle ?? '', actions, from };
		await tick();
		tvFocus(list?.querySelector<HTMLElement>('[data-tv-item]') ?? null);
	}

	async function close() {
		const from = menu?.from;
		menu = null;
		await tick();
		if (from?.isConnected) tvFocus(from);
		else startTvNav(document.querySelector<HTMLElement>('[data-tv-app]'));
	}

	async function act(action: Action) {
		if (busy) return;
		busy = true;
		try {
			await action.run();
			await invalidateAll();
		} catch {
		} finally {
			busy = false;
			close();
		}
	}
</script>

{#if menu}
	<div class="sheet" data-tv-sheet>
		<div class="box">
			{#if menu.title}<p class="name">{menu.title}</p>{/if}
			<div class="actions" bind:this={list} data-tv-row data-tv-grid>
				{#each menu.actions as action (action.label)}
					<button type="button" class="action" data-tv-item disabled={busy} onclick={() => act(action)}>{action.label}</button>
				{/each}
			</div>
		</div>
	</div>
{/if}

<style>
	.sheet {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: grid;
		place-items: center;
		background: rgb(0 0 0 / 55%);
	}

	.box {
		display: flex;
		flex-direction: column;
		gap: 1.4vw;
		min-width: 30vw;
		max-width: 45vw;
		padding: 2vw;
		border-radius: 1vw;
		background: var(--surface);
		box-shadow: 0 1vw 4vw rgb(0 0 0 / 60%);
	}

	.name {
		margin: 0;
		font-family: var(--display);
		font-size: 2vw;
		font-weight: 600;
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 0.6vw;
	}

	.action {
		padding: 1vw 1.4vw;
		border: none;
		border-radius: 0.6vw;
		background: rgb(255 255 255 / 8%);
		color: var(--ink);
		font: inherit;
		font-size: 1.6vw;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
		outline: none;
	}

	.action:focus,
	.action:global(.tv-focused) {
		background: var(--ink);
		color: var(--paper);
	}
</style>
