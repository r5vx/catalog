<script lang="ts">
	import '../app.css';
	import { inkFor, DEFAULT_ACCENT } from '$lib/accent';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	const accent = $derived(data?.accent ?? DEFAULT_ACCENT);

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

<div class="app" style={accentCss}>
	{@render children()}
</div>

<style>
	.app {
		max-width: 1180px;
		margin: 0 auto;
		padding-inline: 20px;
		padding-block: 28px 80px;
	}

	@media (max-width: 520px) {
		.app {
			padding-inline: 14px;
			padding-block: 18px 60px;
		}
	}
</style>
