<script lang="ts">
	/**
	 * After an update: a small card in the corner with the version's name and a few of its New
	 * lines, straight from the release notes (src/lib/server/whatsNewCard.ts decides when). Close
	 * it, or See everything for the whole list in Settings → Updates; either way it's gone for
	 * this version. Never over the player or the PIN screen.
	 */
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { tick } from 'svelte';

	type Card = { version: string; title: string | null; lines: string[]; more: number };

	const card = $derived(page.data.whatsNew as Card | null | undefined);
	let closed = $state(false);
	let closeButton: HTMLButtonElement | undefined = $state();
	const tv = $derived(page.url.pathname.startsWith('/tv'));
	const hidden = $derived(/^\/(watch|login|profiles|welcome|setup|tv\/profiles|speech-maker|word-timer|strip-maker|skip-maker|caption-timer)/.test(page.url.pathname));
	$effect(() => {
		if (card && !closed && !hidden && tv) {
			const frame = requestAnimationFrame(() => requestAnimationFrame(() => closeButton?.focus()));
			return () => cancelAnimationFrame(frame);
		}
	});
	function remote(event: KeyboardEvent) {
		if (!tv || !card || closed || hidden) return;
		const buttons = [...document.querySelectorAll<HTMLButtonElement>('.whats-new button')];
		const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key.startsWith('Arrow')) {
			const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
			buttons[(Math.max(0, index) + direction + buttons.length) % buttons.length]?.focus();
		} else if (['Escape', 'Backspace', 'GoBack', 'BrowserBack'].includes(event.key) || event.keyCode === 10009) {
			seen();
		} else return;
		event.preventDefault();
		event.stopPropagation();
	}

	function seen() {
		closed = true;
		fetch('/api/whats-new', { method: 'POST' }).catch(() => {});
		if (tv) tick().then(() => document.querySelector<HTMLElement>('[data-tv-autofocus]')?.focus());
	}

	function seeEverything() {
		seen();
		goto(tv ? '/tv/settings/updates' : '/settings/updates');
	}
</script>

<svelte:window onkeydown={remote} />

{#if card && !closed && !hidden}
	<aside class="whats-new" class:tv aria-label="What's new">
		<button type="button" class="close" aria-label="Close" bind:this={closeButton} onclick={seen}>
			<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
				<path d="M6 6l12 12M18 6L6 18" />
			</svg>
		</button>
		<p class="eyebrow">New in {card.version}</p>
		{#if card.title}<h2>{card.title}</h2>{/if}
		<ul>
			{#each card.lines as line, i (i)}
				<li>{line}</li>
			{/each}
		</ul>
		<div class="actions">
			<button type="button" class="btn btn-primary" onclick={seeEverything}>{card.more ? `See all ${card.lines.length + card.more}` : 'See everything'}</button>
			<button type="button" class="btn" onclick={seen}>Got it</button>
		</div>
	</aside>
{/if}

<style>
	.whats-new {
		position: fixed;
		right: 20px;
		bottom: 20px;
		z-index: 950;
		width: min(360px, calc(100vw - 32px));
		padding: 16px 18px 14px;
		border: 1px solid var(--rule);
		border-radius: 10px;
		background: var(--surface);
		box-shadow: var(--shadow), 0 12px 32px -12px rgb(0 0 0 / 35%);
		animation: rise 0.35s ease-out;
	}
	.whats-new.tv { width: 34vw; right: 3vw; bottom: 3vw; padding: 1.5vw; font-size: 1.2vw; }
	.tv h2 { font-size: 1.7vw; }
	.tv .eyebrow { font-size: 1vw; }
	.tv ul { font-size: 1.2vw; }
	.tv .close { width: 2.4vw; height: 2.4vw; }
	.tv button:focus { outline: 3px solid var(--accent); outline-offset: 3px; }

	.close {
		position: absolute;
		top: 10px;
		right: 10px;
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: 0;
		border-radius: 50%;
		background: none;
		color: var(--ink-faint);
		cursor: pointer;
	}

	.close:hover {
		background: var(--surface-2);
		color: var(--ink);
	}

	.eyebrow {
		margin: 0;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--accent);
	}

	h2 {
		margin: 4px 28px 10px 0;
		font-family: var(--display);
		font-size: 1.15rem;
		line-height: 1.25;
	}

	ul {
		margin: 0 0 14px;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 0.88rem;
		line-height: 1.4;
		color: var(--ink-soft);
	}

	.actions {
		display: flex;
		gap: 8px;
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
</style>
