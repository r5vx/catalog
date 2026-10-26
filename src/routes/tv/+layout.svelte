<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate, pushState } from '$app/navigation';
	import { startTvNav, tvBack, MENU_SCREENS } from '$lib/tvNav';
	import TvMenu from '$lib/tv/TvMenu.svelte';
	import { onMount, tick, type Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	/**
	 * Catalog on a TV, made for the remote (the TV app opens here; see src/lib/tvNav.ts for how
	 * the arrows move). A menu down the left like Netflix's, and the screen beside it. Everything
	 * is sized from the screen's width, so it reads the same from the sofa on any TV, and kept in
	 * from the edges, which some TVs cut off.
	 */
	let { data, children }: { data: LayoutData; children: Snippet } = $props();
	let app: HTMLElement | undefined = $state();
	/** A poster's menu is open: everything else is out of reach until it closes. */
	let menuOpen = $state(false);

	const MENU = [
		{ href: '/tv/search', label: 'Search', icon: 'search' },
		{ href: '/tv', label: 'Home', icon: 'home' },
		{ href: '/tv/browse/movies', label: 'Movies', icon: 'movie' },
		{ href: '/tv/browse/tv', label: 'TV Shows', icon: 'tv' },
		{ href: '/tv/browse/anime', label: 'Anime', icon: 'anime' },
		{ href: '/tv/library', label: 'My Library', icon: 'library' },
		{ href: '/tv/live', label: 'Live TV', icon: 'live' },
		{ href: '/tv/settings', label: 'Settings', icon: 'settings' }
	] as const;

	// "Who's watching?" fills the screen, with no menu.
	const picking = $derived(page.url.pathname.startsWith('/tv/profiles'));

	const here = (href: string) =>
		href === '/tv' ? page.url.pathname === '/tv' : page.url.pathname.startsWith(href);

	/*
	 * The TV app before 1.2 handles Back itself: back a page, or out of the app when there's none —
	 * so Back on Home closed Catalog. A spare step in the history (same page, marked tvGuard) is
	 * what Back takes off there instead, and Catalog then does what Back should (opens the menu,
	 * then goes Home) and puts the step back. With that app Back never leaves; the remote's Home
	 * button does. (TV app 1.2 asks Catalog first, so the spare step is never used there.)
	 */
	let guardedPath = '';
	async function guard() {
		const path = page.url.pathname;
		if (!MENU_SCREENS.test(path) || (page.state as { tvGuard?: boolean }).tvGuard) return;
		await tick();
		pushState('', { tvGuard: true });
		guardedPath = path;
	}
	onMount(() => {
		const onPop = () =>
			setTimeout(() => {
				// Only the spare step coming off: still the same page, now without the mark.
				if (location.pathname !== guardedPath || (page.state as { tvGuard?: boolean }).tvGuard) return;
				tvBack();
				guard();
			}, 0);
		window.addEventListener('popstate', onPop);
		return () => window.removeEventListener('popstate', onPop);
	});

	// Each screen starts with something highlighted.
	afterNavigate(() => {
		startTvNav(app ?? null);
		guard();
	});
</script>

<div class="tv-app" data-tv-app bind:this={app}>
	{#if !picking}
	<nav class="tv-nav" data-tv-nav aria-label="Menu" inert={menuOpen}>
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
					{:else if item.icon === 'live'}
						<!-- An aerial on a screen. -->
						<rect x="3" y="8" width="18" height="12" rx="2" /><path d="M8 3l4 5 4-5" />
					{:else}
						<!-- A gear. -->
						<circle cx="12" cy="12" r="3" />
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
					{/if}
				</svg>
				<span class="label">{item.label}</span>
			</a>
		{/each}
	</nav>
	{/if}

	<main class="tv-main" class:full={picking} data-tv-main>
		<div class="screen" inert={menuOpen}>
			{@render children()}
		</div>
		<TvMenu bind:showing={menuOpen} />
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
		/* The rest of the screen, darkened while the menu's open (a shadow spread over all of it). */
		box-shadow: 0 0 0 100vmax rgb(0 0 0 / 0%);
		transition: width 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
	}

	/* Open while it's highlighted: wider, with its names, over a darkened screen. */
	:global(.tv-app.nav-open) .tv-nav {
		width: 24vw;
		/* Fades into the same darkening as the rest of the screen, so there's no seam. */
		background: linear-gradient(90deg, var(--paper) 70%, rgb(0 0 0 / 45%));
		box-shadow: 0 0 0 100vmax rgb(0 0 0 / 45%);
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

	.screen {
		position: absolute;
		inset: 0;
	}
</style>
