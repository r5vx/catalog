<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate, goto, pushState } from '$app/navigation';
	import { startTvNav, tvBack, tvFocus, MENU_SCREENS } from '$lib/tvNav';
	import { together, type RoomState } from '$lib/watchTogether.svelte';
	import { watchHref } from '$lib/friendLinks';
	import TvMenu from '$lib/tv/TvMenu.svelte';
	import Wordmark from '$lib/Wordmark.svelte';
	import ThisWeekDot from '$lib/ThisWeekDot.svelte';
	import { p } from '$lib/altText';
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
		{ href: '/tv', label: 'Library', icon: 'home' },
		{ href: '/tv/new', label: 'Home', icon: 'calendar' },
		{ href: '/tv/browse/movies', label: 'Movies', icon: 'movie' },
		{ href: '/tv/browse/tv', label: 'TV Shows', icon: 'tv' },
		{ href: '/tv/browse/anime', label: 'Anime', icon: 'anime' },
		{ href: '/tv/library', label: 'My Library', icon: 'library' },
		{ href: '/tv/friends', label: 'Friends', icon: 'friends' },
		{ href: '/tv/live', label: 'Live TV', icon: 'live' },
		{ href: '/tv/youtube', label: 'YouTube', icon: 'youtube' },
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

	/*
	 * Someone in the watch-together room started something (Friends → Watch along put this TV in
	 * it): Join or Not now, highlighted as it comes up. The computer's corner box can't be reached
	 * with the remote on these screens (lib/ChatOverlay.svelte); in the player it can.
	 */
	let joinButton = $state<HTMLButtonElement | null>(null);
	const offer = $derived(together.offer);
	$effect(() => {
		if (offer && joinButton) tvFocus(joinButton);
	});
	const offerLabel = (state: RoomState) => (state.type === 'tv' && state.season ? `${state.title} S${state.season}E${state.episode}` : state.title);
	async function joinOffer(state: RoomState) {
		together.offer = null;
		await goto(watchHref(state));
	}
	function skipOffer() {
		together.offer = null;
		startTvNav(app ?? null);
	}

	// Each screen starts with something highlighted.
	afterNavigate(() => {
		startTvNav(app ?? null);
		guard();
	});
</script>

<div class="tv-app" data-tv-app bind:this={app}>
	{#if !picking}
	<nav class="tv-nav" data-tv-nav aria-label="Menu" inert={menuOpen}>
		<!-- The logo: the pink dot while the menu is shut, the whole name once it opens. Not a stop for the remote. -->
		<div class="brand" aria-hidden="true">
			<span class="brand-dot" style:--logo-dot={page.data.logo?.dot || null}></span>
			{#if page.data.altMode}
				<span class="brand-full brand-words">{p('Catalog')}</span>
			{:else}
				<span class="brand-full"><Wordmark height="2.1vw" /></span>
			{/if}
		</div>
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
					{:else if item.icon === 'calendar'}
						<rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 11h18" />
					{:else if item.icon === 'movie'}
						<rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M8 5v4M16 5v4" />
					{:else if item.icon === 'tv'}
						<rect x="3" y="6" width="18" height="12" rx="2" /><path d="M8 21h8M9 3l3 3 3-3" />
					{:else if item.icon === 'anime'}
						<path d="M12 3.5 14.4 9l5.6.5-4.3 3.7 1.4 5.6L12 15.8 6.9 18.8l1.4-5.6L4 9.5 9.6 9Z" />
					{:else if item.icon === 'library'}
						<path d="M5 4v16M10 4v16M15 4.5l4.5 15" />
					{:else if item.icon === 'friends'}
						<!-- Two people. -->
						<circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6" /><circle cx="17" cy="9" r="2.6" /><path d="M16 14.2c2.9.2 5 2.4 5 5.3" />
					{:else if item.icon === 'live'}
						<!-- An aerial on a screen. -->
						<rect x="3" y="8" width="18" height="12" rx="2" /><path d="M8 3l4 5 4-5" />
					{:else if item.icon === 'youtube'}
						<!-- A play button. -->
						<rect x="2.5" y="5.5" width="19" height="13" rx="4" /><path d="M10 9.2v5.6l4.8-2.8Z" />
					{:else}
						<!-- A gear. -->
						<circle cx="12" cy="12" r="3" />
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
					{/if}
				</svg>
				<span class="label">{item.label}{#if item.href === '/tv/new'} <ThisWeekDot />{/if}</span>
			</a>
		{/each}
	</nav>
	{/if}

	<main class="tv-main" class:full={picking} data-tv-main>
		<div class="screen" inert={menuOpen}>
			{@render children()}
		</div>
		<TvMenu bind:showing={menuOpen} />
		{#if offer && !menuOpen}
			<div class="room-offer" role="dialog" aria-label="Someone in the room started something" data-tv-row>
				<p><strong>{offer.by}</strong> started <strong>{offerLabel(offer)}</strong></p>
				<button type="button" class="offer-button" data-tv-item bind:this={joinButton} onclick={() => joinOffer(offer)}>Join</button>
				<button type="button" class="offer-button" data-tv-item onclick={skipOffer}>Not now</button>
			</div>
		{/if}
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

	/* A room's "started" box, bottom right. */
	.room-offer {
		position: absolute;
		right: 3vw;
		bottom: 5vh;
		z-index: 6;
		display: flex;
		align-items: center;
		gap: 1vw;
		padding: 1.2vw 1.6vw;
		border-radius: 0.9vw;
		background: var(--surface-2, #222);
		box-shadow: 0 0.6vw 2vw rgb(0 0 0 / 50%);
	}

	.room-offer p {
		margin: 0 0.6vw 0 0;
		font-size: 1.4vw;
	}

	.offer-button {
		padding: 0.7vw 1.5vw;
		border: none;
		border-radius: 100vw;
		background: rgb(255 255 255 / 12%);
		color: var(--ink);
		font: inherit;
		font-size: 1.3vw;
		font-weight: 700;
		outline: none;
	}

	.offer-button:focus,
	.offer-button:global(.tv-focused) {
		background: var(--ink);
		color: var(--paper);
	}

	/* ------------------------------------------------------------ the menu */

	.tv-nav {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		z-index: 5;
		width: 7vw;
		padding: 10vh 0 0 1.6vw;
		display: flex;
		flex-direction: column;
		gap: 0.35vw;
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

	/* The logo at the top, lined up with the icons below it. */
	.brand {
		position: absolute;
		top: 3.6vh;
		left: 2.5vw;
		height: 2.1vw;
		display: flex;
		align-items: center;
	}

	/* Shut: the dot alone, the icon's circle, centered over the icons. */
	.brand-dot {
		position: absolute;
		left: 0.45vw;
		width: 1.4vw;
		height: 1.4vw;
		border-radius: 50%;
		background: var(--logo-dot, #e994c2);
		transition: opacity 0.15s ease;
	}

	.brand-full {
		opacity: 0;
		color: var(--ink);
		transition: opacity 0.15s ease;
	}

	.brand-words {
		font-family: var(--display);
		font-size: 2vw;
		font-weight: 800;
		white-space: nowrap;
	}

	:global(.tv-app.nav-open) .brand-dot {
		opacity: 0;
	}

	:global(.tv-app.nav-open) .brand-full {
		opacity: 1;
	}

	.tv-nav-item {
		display: flex;
		align-items: center;
		gap: 1.4vw;
		width: fit-content;
		padding: 0.55vw 1.2vw 0.55vw 0.9vw;
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
