<script lang="ts">
	/**
	 * The sidebar (Settings → Personalization → Layout): every part of the library, Browse and
	 * Settings, one click away from anywhere, so getting back from deep in Browse isn't "back to
	 * top", then Library, then the tab. The library part is the library's own tabs, stacked:
	 * drag one to move it, right-click to hide it (or the "…" to bring hidden ones back).
	 * Not on narrow screens, where there's no room beside the page.
	 */
	import CategoryTabs from '$lib/CategoryTabs.svelte';
	import TabIcon from '$lib/TabIcon.svelte';
	import { page } from '$app/state';

	const tabs = $derived(page.data.sideTabs);

	/** Which library tab is the page you're on ('' is All; none off the library's pages). */
	const active = $derived.by(() => {
		const path = page.url.pathname;
		if (path === '/') return page.url.searchParams.get('cat') ?? '';
		if (path.startsWith('/orders')) return 'orders';
		if (path.startsWith('/notes')) return 'notes';
		return '-';
	});

	const elsewhere = [
		{ key: 'browse', href: '/browse', label: 'Browse' },
		{ key: 'settings', href: '/settings', label: 'Settings' }
	];
	const here = (href: string) => page.url.pathname === href || page.url.pathname.startsWith(href + '/');
</script>

<nav class="side" aria-label="Sections">
	<p class="label">Library</p>
	{#if tabs}
		<CategoryTabs {...tabs} {active} vertical poisonMode={page.data.poisonMode} />
	{/if}
	<hr />
	{#each elsewhere as link (link.key)}
		<a href={link.href} class:here={here(link.href)}>
			<TabIcon name={link.key} />
			{link.label}
		</a>
	{/each}
</nav>

<style>
	.side {
		position: fixed;
		top: 0;
		left: 0;
		bottom: 0;
		width: 236px;
		padding: 28px 12px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		border-right: 1px solid var(--rule);
		background: var(--paper);
		overflow-y: auto;
		z-index: 50;
	}

	/* With a background picture (Settings → Personalization), it shows through a little. */
	:global(html.has-background) .side {
		background: color-mix(in srgb, var(--paper) 78%, transparent);
	}

	.label {
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin: 0 10px 8px;
	}

	a {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border-radius: var(--radius-sm);
		color: var(--ink-soft);
		font-size: 0.86rem;
		text-decoration: none;
	}

	a:hover {
		background: var(--hover);
		color: var(--ink);
	}

	a.here {
		background: var(--accent-bg);
		color: var(--accent);
		font-weight: 600;
	}

	hr {
		border: none;
		border-top: 1px solid var(--rule);
		margin: 10px 6px;
	}

	@media (max-width: 900px) {
		.side {
			display: none;
		}
	}

	:global(html.tv) .side {
		display: none;
	}
</style>
