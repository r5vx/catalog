<script lang="ts">
	import type { TileMenu } from './tiles';
	/**
	 * A poster on the TV screens. Highlighted, it grows and gets a white ring, so it's obvious
	 * from across the room which one OK will open.
	 */
	let {
		href,
		title,
		poster,
		note = null,
		progress = null,
		showTitle = false,
		autofocus = false,
		menu = undefined,
		onfocus
	}: {
		href: string;
		title: string;
		poster: string | null;
		/** Small text over the bottom of the poster: "S2E6", "Watching". */
		note?: string | null;
		/** How far through it you are, 0 to 1: a bar along the bottom. */
		progress?: number | null;
		/** The name under the poster (where there's no banner saying it). */
		showTitle?: boolean;
		autofocus?: boolean;
		/** What the remote's menu button offers for it. */
		menu?: TileMenu;
		onfocus?: () => void;
	} = $props();
</script>

<a {href} class="tv-card" class:with-title={showTitle} data-tv-item data-tv-menu={menu ? JSON.stringify(menu) : undefined} data-tv-title={title} data-tv-autofocus={autofocus || undefined} {onfocus}>
	<span class="poster">
		{#if poster}
			<img src={poster} alt="" loading="lazy" />
		{:else}
			<span class="no-poster">{title}</span>
		{/if}
		{#if note}<span class="note">{note}</span>{/if}
		{#if progress !== null && progress > 0}
			<span class="bar"><span class="fill" style:width="{Math.min(100, Math.max(4, progress * 100))}%"></span></span>
		{/if}
	</span>
	{#if showTitle}<span class="title">{title}</span>{/if}
</a>

<style>
	.tv-card {
		flex: none;
		width: 12.5vw;
		display: flex;
		flex-direction: column;
		gap: 0.7vw;
		color: var(--ink);
		text-decoration: none;
		outline: none;
	}

	.poster {
		position: relative;
		display: block;
		aspect-ratio: 2 / 3;
		border-radius: 0.6vw;
		overflow: hidden;
		background: var(--surface-2);
		transition: transform 0.15s ease, box-shadow 0.15s ease;
	}

	.poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.no-poster {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 1vw;
		text-align: center;
		font-size: 1.3vw;
		font-weight: 600;
		color: var(--ink-soft);
	}

	/* Highlighted: bigger, with a white ring and a glow. */
	.tv-card:focus .poster,
	.tv-card:global(.tv-focused) .poster {
		transform: scale(1.08);
		box-shadow:
			0 0 0 0.3vw var(--ink),
			0 1vw 2.5vw rgb(0 0 0 / 60%);
	}

	/* With its name underneath, it grows upwards instead, so it never covers the name. */
	.tv-card.with-title .poster {
		transform-origin: center bottom;
	}

	.tv-card:focus,
	.tv-card:global(.tv-focused) {
		position: relative;
		z-index: 1;
	}

	.note {
		position: absolute;
		left: 0.6vw;
		bottom: 0.9vw;
		padding: 0.2vw 0.6vw;
		border-radius: 0.4vw;
		background: rgb(0 0 0 / 75%);
		color: #fff;
		font-size: 1.05vw;
		font-weight: 700;
	}

	.bar {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 0.45vw;
		background: rgb(255 255 255 / 25%);
	}

	.fill {
		display: block;
		height: 100%;
		background: var(--accent);
	}

	.title {
		font-size: 1.25vw;
		font-weight: 600;
		line-height: 1.25;
		overflow: hidden;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		transition: color 0.15s ease;
	}

	.tv-card:focus .title,
	.tv-card:global(.tv-focused) .title {
		color: var(--accent);
	}
</style>
