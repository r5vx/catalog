<script lang="ts">
	/**
	 * Back to the video kept loaded while another page is open (src/lib/keptPlayer.svelte.ts):
	 * in the sidebar, or (`floating`) bottom left where there's no sidebar (`besideNav`: there is
	 * one, so this shows only where it's hidden, on narrow windows). The x lets it go.
	 */
	import { page } from '$app/state';
	import { keptPlayer, letGo, showKept } from '$lib/keptPlayer.svelte';

	let { floating = false, besideNav = false }: { floating?: boolean; besideNav?: boolean } = $props();

	const kept = $derived(keptPlayer.current);
	const shown = $derived(Boolean(kept?.keepable && kept.title) && page.url.pathname !== '/watch');
	const episode = $derived(kept?.season ? `S${kept.season} E${kept.episode}` : '');
</script>

{#if shown && kept}
	<div class="now" class:floating class:beside-nav={besideNav}>
		<button type="button" class="back" onclick={showKept} title="Back to {kept.title}">
			{#if kept.poster}
				<img src={kept.poster} alt="" />
			{:else}
				<span class="play" aria-hidden="true">
					<svg viewBox="0 0 16 16" width="12" height="12"><path d="M5 3.5v9l7-4.5z" /></svg>
				</span>
			{/if}
			<span class="words">
				<span class="label">Now playing</span>
				<span class="name">{kept.title}{#if episode}<span class="ep"> · {episode}</span>{/if}</span>
			</span>
		</button>
		<button type="button" class="close" onclick={letGo} title="Close the video" aria-label="Close the video">
			<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
		</button>
	</div>
{/if}

<style>
	.now {
		display: flex;
		align-items: center;
		gap: 2px;
		margin: 0 0 14px;
		padding: 4px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
	}

	/* Where there's no sidebar: bottom left, over the page. */
	.now.floating {
		position: fixed;
		left: 14px;
		bottom: 14px;
		z-index: 70;
		max-width: min(340px, calc(100vw - 28px));
		margin: 0;
		box-shadow: var(--shadow);
	}

	@media (min-width: 901px) {
		.now.floating.beside-nav {
			display: none;
		}
	}

	:global(html.tv) .now {
		display: none;
	}

	.back {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 6px;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}

	.back:hover {
		background: var(--hover, var(--surface-2));
	}

	img,
	.play {
		flex: none;
		width: 28px;
		height: 42px;
		border-radius: 3px;
		object-fit: cover;
	}

	.play {
		display: grid;
		place-items: center;
		background: var(--accent);
		color: var(--accent-ink);
	}

	.play path {
		fill: currentColor;
	}

	.words {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.label {
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--accent);
	}

	.name {
		font-size: 0.84rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ep {
		color: var(--ink-faint);
	}

	.close {
		flex: none;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--ink-faint);
		cursor: pointer;
	}

	.close:hover {
		background: var(--surface-2);
		color: var(--ink);
	}

	.close path {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linecap: round;
	}
</style>
