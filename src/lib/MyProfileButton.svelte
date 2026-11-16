<script lang="ts">
	/**
	 * Your picture, as a button to your own profile (owner, 2026-11-15: My profile was "really hard to
	 * even see" on the Friends page). In the library's top bar (src/lib/LibraryHeader.svelte) and
	 * the sidebar (src/lib/SideNav.svelte, `wide`, with the words). Only when this Catalog is online.
	 */
	import { page } from '$app/state';
	import Avatar from '$lib/Avatar.svelte';

	let { wide = false }: { wide?: boolean } = $props();

	const me = $derived(page.data.onlineMe as { id: string; name: string; avatar: number } | null | undefined);
	const href = $derived(`/friends/${me?.id || 'me'}`);
	const here = $derived(Boolean(me?.id) && page.url.pathname === `/friends/${me?.id}`);
</script>

{#if me}
	<a {href} class="my-profile" class:wide class:here title="My profile" aria-label={wide ? undefined : 'My profile'}>
		{#if me.id}
			<Avatar id={me.id} name={me.name || '?'} rev={me.avatar} size={wide ? 22 : 30} />
		{:else}
			<svg viewBox="0 0 24 24" width={wide ? 20 : 22} height={wide ? 20 : 22} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
				<circle cx="12" cy="8" r="4" />
				<path d="M4 21a8 8 0 0 1 16 0" />
			</svg>
		{/if}
		{#if wide}<span>My profile</span>{/if}
	</a>
{/if}

<style>
	/* In the top bar: a round button the size of the others beside it. */
	.my-profile:not(.wide) {
		display: inline-grid;
		place-items: center;
		width: 38px;
		height: 38px;
		border: 1px solid var(--rule);
		border-radius: 50%;
		background: var(--surface);
		color: var(--ink-soft);
		text-decoration: none;
		overflow: hidden;
	}

	.my-profile:not(.wide):hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	/* In the sidebar: a line like the other links there. */
	.wide {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 10px;
		border-radius: var(--radius-sm);
		color: var(--ink-soft);
		text-decoration: none;
		font-size: 0.86rem;
	}

	.wide:hover {
		background: var(--hover);
		color: var(--ink);
	}

	.wide.here {
		background: var(--accent-bg);
		color: var(--accent);
		font-weight: 600;
	}
</style>
