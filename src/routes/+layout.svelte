<script lang="ts">
	import '../app.css';
	import UpdateBanner from '$lib/UpdateBanner.svelte';
	import TvUpdated from '$lib/tv/TvUpdated.svelte';
	import SigninBanner from '$lib/SigninBanner.svelte';
	import ConfirmDialog from '$lib/ConfirmDialog.svelte';
	import RatePrompt from '$lib/RatePrompt.svelte';
	import SideNav from '$lib/SideNav.svelte';
	import { navigating, page } from '$app/state';
	import { beforeNavigate } from '$app/navigation';
	import { rememberBeforeSettings } from '$lib/nav';
	import { onMount } from 'svelte';
	import { startTv } from '$lib/tv';
	import { inkFor, DEFAULT_ACCENT } from '$lib/accent';
	import { backgroundPreview } from '$lib/backgroundPreview.svelte';
	import { sendKeptPlaces } from '$lib/phoneKeep.svelte';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	const accent = $derived(data?.accent ?? DEFAULT_ACCENT);

	// The sidebar, when turned on: not over the player, the TV's own layout, or the pages before
	// signing in.
	const sideNav = $derived(
		Boolean(data?.sideNav) && !/^\/(watch|tv|strip-maker|skip-maker|speech-maker|login|welcome)(\/|$)/.test(page.url.pathname)
	);

	// The picture behind the pages, if one is picked (Settings → Personalization): not behind the
	// player or the TV's own layout, which have their own pictures.
	const background = $derived(
		data?.background && !/^\/(watch|tv|strip-maker|skip-maker|speech-maker)(\/|$)/.test(page.url.pathname) ? data.background : null
	);
	const backgroundDim = $derived(backgroundPreview.dim ?? background?.dim ?? 0);
	const backgroundBlur = $derived(backgroundPreview.blur ?? background?.blur ?? 0);
	$effect(() => {
		document.documentElement.classList.toggle('has-background', Boolean(background));
	});

	// On a TV (the Fire TV app), the remote's arrows move around the page.
	onMount(startTv);

	// The phone app (the secure Tailscale address, Settings → Phones): its offline page is made
	// ready (static/sw.js), and places from watching with no connection are handed back. Never
	// on the computer Catalog runs on, nor on a plain http:// address.
	onMount(() => {
		const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
		if (!window.isSecureContext || local || location.protocol !== 'https:' || !('serviceWorker' in navigator)) return;
		navigator.serviceWorker.register('/sw.js').catch(() => {});
		sendKeptPlaces().catch(() => {});
	});

	// Whether this browser keeps what pages remember from one start to the next (/api/diagnostics →
	// storage): the owner's desktop app kept nothing after 2026-10-10. Once per start.
	onMount(() => {
		let since: string | null = null;
		let works = true;
		try {
			since = localStorage.getItem('catalog:storageSince');
			if (!since) localStorage.setItem('catalog:storageSince', String(Date.now()));
		} catch {
			works = false;
		}
		fetch('/api/storage-health', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ since: since ? Number(since) : null, works })
		}).catch(() => {});
	});

	// Opening Settings from anywhere: remember the page and scroll position to go back to.
	beforeNavigate(({ from, to }) => {
		const into = to?.url.pathname.startsWith('/settings');
		const outOf = from?.url.pathname.startsWith('/settings');
		if (from && into && !outOf) rememberBeforeSettings(from.url.pathname + from.url.search, window.scrollY);
	});

	$effect(() => {
		const t = data?.theme;
		if (t) document.documentElement.dataset.theme = t;
		else delete document.documentElement.dataset.theme;
	});

	/**
	 * Only the accent is stored; the shades around it are derived so one colour
	 * choice stays coherent in both themes. color-mix keeps the tint relative to
	 * the current background rather than a fixed light or dark value.
	 */
	const accentCss = $derived(
		`--accent: ${accent};` +
			`--accent-ink: ${inkFor(accent)};` +
			`--accent-bg: color-mix(in srgb, ${accent} 14%, var(--surface));`
	);
</script>

<svelte:head>
	<title>Catalog</title>
	<link rel="icon" href="/icon.png" />

	<!-- "Add to Home Screen" on your phone uses these. -->
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="apple-touch-icon" href="/icon-180.png" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-title" content="Catalog" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="theme-color" content={accent} />
</svelte:head>

{#if background}
	<div
		class="page-background"
		class:blurred={backgroundBlur > 0}
		aria-hidden="true"
		style:background-image="url('{background.image}')"
		style:filter={backgroundBlur > 0 ? `blur(${backgroundBlur}px)` : null}
		style:--dim={backgroundDim / 100}
	></div>
{/if}
{#if sideNav}<div style={accentCss}><SideNav /></div>{/if}
<div class="app" class:wide={data?.wideLayout} class:beside-nav={sideNav} style={accentCss}>
	<!-- Shows a click was heard while the next page loads; hidden for quick ones. -->
	{#if navigating.to}
		<div class="nav-progress" aria-hidden="true"></div>
	{/if}
	<UpdateBanner />
	<TvUpdated />
	<SigninBanner signin={data?.showboxSignin} />
	{@render children()}
	<ConfirmDialog />
	<!-- "Rate it" after leaving the player (not over it, nor on a TV's screens). -->
	{#if !/^\/(watch|tv)(\/|$)/.test(page.url.pathname)}<RatePrompt />{/if}
</div>

<style>
	/*
	 * The picture behind the pages. It fades toward the theme's own background by --dim (the
	 * Dim slider), so text stays readable in light and dark themes alike. Cards stay solid.
	 */
	.page-background {
		position: fixed;
		inset: 0;
		z-index: -1;
		background-position: center;
		background-size: cover;
		background-repeat: no-repeat;
		pointer-events: none;
	}

	/* Blurring softens the edges too: drawn a little bigger so they stay off screen. */
	.page-background.blurred {
		inset: -48px;
	}

	.page-background::after {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--paper);
		opacity: var(--dim);
	}

	.app {
		max-width: 1180px;
		margin: 0 auto;
		padding-inline: 20px;
		padding-block: 28px 80px;
	}

	.app.wide {
		max-width: none;
		padding-inline: 40px;
	}

	/* Room for the sidebar, and the page centred in what's left. */
	@media (min-width: 901px) {
		.app.beside-nav {
			margin-left: max(256px, calc((100vw - 1180px + 236px) / 2));
			margin-right: auto;
		}

		.app.beside-nav.wide {
			margin-left: 236px;
		}

		:global(html.tv) .app.beside-nav {
			margin-left: auto;
		}
	}

	.nav-progress {
		position: fixed;
		top: 0;
		left: 0;
		height: 3px;
		width: 100%;
		z-index: 1000;
		background: var(--accent);
		transform-origin: left;
		opacity: 0;
		animation:
			nav-appear 0s linear 150ms forwards,
			nav-grow 8s cubic-bezier(0.1, 0.7, 0.2, 1) 150ms forwards;
	}

	@keyframes nav-appear {
		to { opacity: 1; }
	}

	@keyframes nav-grow {
		from { transform: scaleX(0.05); }
		to { transform: scaleX(0.92); }
	}

	@media (max-width: 520px) {
		.app {
			padding-inline: 14px;
			padding-block: 18px 60px;
		}

		.app.wide {
			padding-inline: 14px;
		}
	}
</style>
