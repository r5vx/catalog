<script lang="ts">
	/*
	 * Pin to sidebar, top right of both Catasong games: Catasong then has its own link in the
	 * sidebar (SideNav.svelte), so the Browse phrase isn't needed each time (owner, 2026-11-26).
	 * Kept on the computer (setting catasongPinned).
	 */
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';

	const pinned = $derived(Boolean(page.data.catasongPinned));
	let saving = $state(false);

	async function toggle() {
		saving = true;
		await fetch('/api/catasong', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ pinned: !pinned })
		}).catch(() => null);
		await invalidateAll();
		saving = false;
	}
</script>

{#if page.data.sideNav}
	<button type="button" class="pin" class:pinned onclick={toggle} disabled={saving} aria-pressed={pinned}>
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8" />
		</svg>
		{pinned ? 'Pinned to sidebar' : 'Pin to sidebar'}
	</button>
{/if}

<style>
	.pin {
		position: absolute;
		top: 0;
		right: 0;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: inherit;
		font-size: 0.82rem;
		color: var(--ink-soft);
		padding: 6px 12px;
		border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
		border-radius: 999px;
		background: color-mix(in srgb, var(--surface) 65%, transparent);
		backdrop-filter: blur(8px);
		cursor: pointer;
	}
	.pin:hover {
		color: var(--ink);
	}
	.pin.pinned {
		color: var(--cs-hot, var(--accent));
		border-color: color-mix(in srgb, var(--cs-hot, var(--accent)) 45%, transparent);
	}
	.pin:disabled {
		opacity: 0.6;
	}
	svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.pinned svg {
		fill: currentColor;
	}
	/* No sidebar on narrow screens or a TV, so nothing to pin to. */
	@media (max-width: 900px) {
		.pin {
			display: none;
		}
	}
	:global(html.tv) .pin {
		display: none;
	}
</style>
