<script lang="ts" module>
	/** One line of a right-click menu: a button, or '-' for a rule between groups. */
	export type MenuItem = { label: string; run: () => void; danger?: boolean } | '-';

	/** Where a right-click (or a ⋯ button) opens the menu, kept inside the window. */
	export function menuAt(event: MouseEvent, items: number): { x: number; y: number } {
		event.preventDefault();
		return { x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - (items * 36 + 16)) };
	}
</script>

<script lang="ts">
	import { fitOnScreen } from '$lib/fitOnScreen';
	/**
	 * A right-click menu: friends' cards, a friend's titles, the room's "started" box. The same look as
	 * the library's own (FriendsView's .ctx-menu). Closes on a pick, a click outside or Escape.
	 */
	let { at, items, close }: { at: { x: number; y: number }; items: MenuItem[]; close: () => void } = $props();

	function pick(item: Exclude<MenuItem, '-'>) {
		close();
		item.run();
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="ctx-backdrop" onclick={close} oncontextmenu={(e) => { e.preventDefault(); close(); }}></div>
<div class="ctx-menu" use:fitOnScreen role="menu" style="left: {at.x}px; top: {at.y}px;">
	{#each items as item, index (index)}
		{#if item === '-'}
			<hr />
		{:else}
			<button type="button" role="menuitem" class:ctx-danger={item.danger} onclick={() => pick(item)}>{item.label}</button>
		{/if}
	{/each}
</div>

<style>
	.ctx-backdrop {
		position: fixed;
		inset: 0;
		z-index: 2900;
	}

	.ctx-menu {
		position: fixed;
		z-index: 2901;
		min-width: 190px;
		background: var(--surface, #1e1e1e);
		border: 1px solid var(--rule, #333);
		border-radius: var(--radius-sm, 6px);
		padding: 4px 0;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}

	button {
		display: block;
		width: 100%;
		padding: 8px 14px;
		border: none;
		background: none;
		color: var(--ink, #ddd);
		text-align: left;
		font: inherit;
		font-size: 0.84rem;
		cursor: pointer;
	}

	button:hover,
	button:focus-visible {
		background: var(--accent);
		color: var(--accent-ink, #fff);
	}

	hr {
		border: none;
		border-top: 1px solid var(--rule, #333);
		margin: 4px 0;
	}

	.ctx-danger {
		color: var(--danger, #c33);
	}

	.ctx-danger:hover {
		background: var(--danger, #c33);
		color: #fff;
	}
</style>
