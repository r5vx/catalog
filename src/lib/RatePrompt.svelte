<script lang="ts">
	/**
	 * "Rate <title>" with the stars, bottom right (clear of the sidebar), after leaving the player
	 * having watched a film or a series' last episode (rateLater.svelte.ts). Out of the way: it goes
	 * by itself after half a minute, or with the cross.
	 */
	import StarRating from '$lib/StarRating.svelte';
	import { ratePrompt } from '$lib/rateLater.svelte';

	let rated = $state<number | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;

	const offer = $derived(ratePrompt.offer);
	$effect(() => {
		if (!offer) return;
		rated = null;
		clearTimeout(timer);
		timer = setTimeout(close, 30_000);
		return () => clearTimeout(timer);
	});

	function close() {
		ratePrompt.offer = null;
	}

	async function rate(value: number | null) {
		const entry = ratePrompt.offer;
		if (!entry || value === null) return;
		rated = value;
		clearTimeout(timer);
		await fetch('/api/entries', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: entry.entryId, action: 'set', fields: { rating: value } })
		}).catch(() => null);
		timer = setTimeout(close, 1200);
	}
</script>

{#if offer}
	<div class="rate-prompt" role="dialog" aria-label="Rate {offer.title}">
		<span class="title">{rated === null ? `Rate ${offer.title}` : 'Rated'}</span>
		<StarRating large value={rated} label="Rate {offer.title}" onchange={rate} />
		<button type="button" class="close" onclick={close} aria-label="Not now">
			<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
		</button>
	</div>
{/if}

<style>
	.rate-prompt {
		position: fixed;
		right: 24px;
		bottom: 24px;
		z-index: 900;
		display: flex;
		align-items: center;
		gap: 12px;
		max-width: calc(100vw - 48px);
		padding: 10px 10px 10px 16px;
		border: 1px solid var(--rule-firm);
		border-radius: 10px;
		background: var(--surface);
		color: var(--ink);
		box-shadow: 0 8px 28px rgb(0 0 0 / 0.35);
		animation: rise 0.35s ease;
	}

	.title {
		font-size: 0.92rem;
		font-weight: 600;
		max-width: 260px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.close {
		display: flex;
		padding: 6px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
	}

	.close:hover {
		background: var(--rule);
		color: var(--ink);
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
	}
</style>
