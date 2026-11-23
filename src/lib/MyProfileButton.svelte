<script lang="ts" module>
	const warmed = new Set<string>();
</script>

<script lang="ts">
	/**
	 * Your picture, as a button to your own profile (owner, 2026-11-15: My profile was "really hard to
	 * even see" on the Friends page). In the library's top bar (src/lib/LibraryHeader.svelte) and
	 * the sidebar (src/lib/SideNav.svelte, `wide`, with the words). Only when this Catalog is online.
	 */
	import { page } from '$app/state';
	import Avatar from '$lib/Avatar.svelte';
	import { preloadData } from '$app/navigation';

	let { wide = false }: { wide?: boolean } = $props();

	type Me = { id: string; name: string; avatar: number };
	const fromPage = $derived(page.data.onlineMe as Me | null | undefined);
	/**
	 * Asked for here when the page didn't know yet. Right after Catalog opens the computer hasn't
	 * heard back from the meeting point, and the page's data isn't asked again on its own, so the
	 * grey stand-in stayed in the top bar until a click (owner, 2026-11-20).
	 */
	let asked = $state<Me | null>(null);
	const me = $derived(fromPage && !fromPage.id && asked?.id ? asked : fromPage);

	$effect(() => {
		if (!fromPage || fromPage.id || asked?.id) return;
		let stopped = false;
		let tries = 0;
		let timer: ReturnType<typeof setTimeout>;
		const ask = async () => {
			try {
				const r = await fetch('/api/online?me=1');
				const answer = r.ok ? ((await r.json()) as { me?: Me | null }).me : null;
				if (!stopped && answer?.id) {
					asked = answer;
					return;
				}
			} catch {}
			// Again in 5, 10, 20, 40 s, then each minute: the meeting point may be slow to answer.
			if (!stopped) timer = setTimeout(ask, Math.min(60_000, 5000 * 2 ** tries++));
		};
		timer = setTimeout(ask, 1500);
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	});
	const href = $derived(`/friends/${me?.id || 'me'}`);
	const here = $derived(Boolean(me?.id) && page.url.pathname === `/friends/${me?.id}`);

	// Asked for once, a few seconds after Catalog opens, so the first click shows it at once too
	// (the page keeps each answer: src/lib/server/online.ts keepProfileAnswer).
	$effect(() => {
		const id = me?.id;
		if (!id || warmed.has(id)) return;
		const timer = setTimeout(() => {
			warmed.add(id);
			preloadData(`/friends/${id}`).catch(() => {});
		}, 4000);
		return () => clearTimeout(timer);
	});
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
