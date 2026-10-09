<script lang="ts">
	import '../app.css';
	import UpdateBanner from '$lib/UpdateBanner.svelte';
	import ConfirmDialog from '$lib/ConfirmDialog.svelte';
	import { navigating } from '$app/state';
	import { beforeNavigate } from '$app/navigation';
	import { rememberBeforeSettings } from '$lib/nav';
	import { onMount } from 'svelte';
	import { startTv } from '$lib/tv';
	import { inkFor, DEFAULT_ACCENT } from '$lib/accent';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	const accent = $derived(data?.accent ?? DEFAULT_ACCENT);

	// On a TV (the Fire TV app), the remote's arrows move around the page.
	onMount(startTv);

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

<div class="app" class:wide={data?.wideLayout} style={accentCss}>
	<!-- Shows a click was heard while the next page loads; hidden for quick ones. -->
	{#if navigating.to}
		<div class="nav-progress" aria-hidden="true"></div>
	{/if}
	<UpdateBanner />
	{@render children()}
	<ConfirmDialog />
</div>

<style>
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
