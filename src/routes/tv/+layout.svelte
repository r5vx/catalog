<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { startTvNav } from '$lib/tvNav';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	/**
	 * Catalog on a TV, made for the remote (the TV app opens here; see src/lib/tvNav.ts for how
	 * the arrows move). A menu down the left like Netflix's, and the screen beside it. Everything
	 * is sized from the screen's width, so it reads the same from the sofa on any TV, and kept in
	 * from the edges, which some TVs cut off.
	 */
	let { data, children }: { data: LayoutData; children: Snippet } = $props();
	let app: HTMLElement | undefined = $state();

	const MENU = [
		{ href: '/tv/search', label: 'Search', icon: 'search' },
		{ href: '/tv', label: 'Home', icon: 'home' },
		{ href: '/tv/browse/movies', label: 'Movies', icon: 'movie' },
		{ href: '/tv/browse/tv', label: 'TV Shows', icon: 'tv' },
		{ href: '/tv/browse/anime', label: 'Anime', icon: 'anime' },
		{ href: '/tv/library', label: 'My Library', icon: 'library' },
		{ href: '/tv/settings', label: 'Settings', icon: 'settings' }
	] as const;

	// "Who's watching?" fills the screen, with no menu.
	const picking = $derived(page.url.pathname.startsWith('/tv/profiles'));

	const here = (href: string) =>
		href === '/tv' ? page.url.pathname === '/tv' : page.url.pathname.startsWith(href);

	// Each screen starts with something highlighted.
	afterNavigate(() => startTvNav(app ?? null));
</script>

<div class="tv-app" data-tv-app bind:this={app}>
	{#if !picking}
	<nav class="tv-nav" data-tv-nav aria-label="Menu">
		<!-- Who's watching: their picture, and OK goes to pick someone else. -->
		<a href="/tv/profiles" class="tv-nav-item" data-tv-item>
			<span class="avatar" style:background={data.profile.color}>{data.profile.name.slice(0, 1).toUpperCase()}</span>
			<span class="label">{data.profile.name}</span>
		</a>
		{#each MENU as item (item.href)}
			<a href={item.href} class="tv-nav-item" data-tv-item aria-current={here(item.href) ? 'page' : undefined}>
				<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
					{#if item.icon === 'search'}
						<circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" />
					{:else if item.icon === 'home'}
						<path d="M3 11 12 4l9 7" /><path d="M5.5 9.5V20h13V9.5" />
					{:else if item.icon === 'movie'}
						<rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M8 5v4M16 5v4" />
					{:else if item.icon === 'tv'}
						<rect x="3" y="6" width="18" height="12" rx="2" /><path d="M8 21h8M9 3l3 3 3-3" />
					{:else if item.icon === 'anime'}
						<path d="M12 3.5 14.4 9l5.6.5-4.3 3.7 1.4 5.6L12 15.8 6.9 18.8l1.4-5.6L4 9.5 9.6 9Z" />
					{:else if item.icon === 'library'}
						<path d="M5 4v16M10 4v16M15 4.5l4.5 15" />
					{:else}
						<circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
					{/if}
				</svg>
				<span class="label">{item.label}</span>
			</a>
		{/each}
	</nav>
	{/if}

	<main class="tv-main" class:full={picking} data-tv-main>
		{@render children()}
	</main>
</div>

<style>
	/* The whole TV screen. 1vw is a hundredth of the screen's width. */
	.tv-app {
		position: fixed;
		inset: 0;
		z-index: 50;
		overflow: hidden;
		background: var(--paper);
		color: var(--ink);
		font-size: 1.45vw;
	}

	/* ------------------------------------------------------------ the menu */

	.tv-nav {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		z-index: 5;
		width: 7vw;
		padding: 7vh 0 0 1.6vw;
		display: flex;
		flex-direction: column;
		gap: 0.6vw;
		background: linear-gradient(90deg, var(--paper) 55%, transparent);
		transition: width 0.2s ease, background 0.2s ease;
	}

	/* Open while it's highlighted: wider, with its names, over a darkened screen. */
	:global(.tv-app.nav-open) .tv-nav {
		width: 24vw;
		background: linear-gradient(90deg, var(--paper) 70%, color-mix(in srgb, var(--paper) 0%, transparent));
		box-shadow: 30vw 0 0 0 rgb(0 0 0 / 45%);
	}

	.tv-nav-item {
		display: flex;
		align-items: center;
		gap: 1.4vw;
		width: fit-content;
		padding: 0.8vw 1.2vw 0.8vw 0.9vw;
		border-radius: 100vw;
		color: var(--ink-soft);
		text-decoration: none;
		font-size: 1.6vw;
		font-weight: 600;
		outline: none;
		white-space: nowrap;
	}

	.icon {
		width: 2.3vw;
		height: 2.3vw;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.9;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.avatar {
		display: grid;
		place-items: center;
		width: 2.6vw;
		height: 2.6vw;
		margin: -0.15vw;
		flex: none;
		border-radius: 0.5vw;
		color: #1a1a1a;
		font-size: 1.4vw;
		font-weight: 800;
	}

	.label {
		opacity: 0;
		transition: opacity 0.15s ease;
	}

	:global(.tv-app.nav-open) .label {
		opacity: 1;
	}

	/* The page you're on, then what's highlighted (white, unmistakable). */
	.tv-nav-item[aria-current='page'] {
		color: var(--accent);
	}

	.tv-nav-item:focus,
	.tv-nav-item:global(.tv-focused) {
		background: var(--ink);
		color: var(--paper);
	}

	/* ------------------------------------------------------------ the screen */

	.tv-main {
		position: absolute;
		inset: 0 0 0 8vw;
		overflow: hidden;
	}

	.tv-main.full {
		left: 0;
	}
</style>
