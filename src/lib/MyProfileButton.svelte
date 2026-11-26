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
	import OnlineStatusPicker from '$lib/OnlineStatusPicker.svelte';
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
	/** The status picked (online, away, dnd, invisible), for the dot on the sidebar picture. */
	const status = $derived((page.data.onlineStatus as string | undefined) ?? 'online');

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
	{#if wide}
		<!--
			The sidebar, like Discord's corner: the picture with the status dot on it, "My profile",
			and under it a button that says the status (a click on it picks another).
		-->
		<span class="me wide" class:here>
			<a {href} class="pic" tabindex="-1" aria-hidden="true">
				{#if me.id}
					<Avatar id={me.id} name={me.name || '?'} rev={me.avatar} size={32} />
				{:else}
					<span class="stand-in">
						<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
							<circle cx="12" cy="8" r="4" />
							<path d="M4 21a8 8 0 0 1 16 0" />
						</svg>
					</span>
				{/if}
				<span class="corner {status}"></span>
			</a>
			<a {href} class="name">My profile</a>
			<OnlineStatusPicker wide />
		</span>
	{:else}
		<!-- The top bar: the picture as a round button, with the status dot on its corner (a click on the dot picks the status). -->
		<span class="me">
			<a {href} class="my-profile" class:here title="My profile" aria-label="My profile">
				{#if me.id}
					<Avatar id={me.id} name={me.name || '?'} rev={me.avatar} size={30} />
				{:else}
					<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
						<circle cx="12" cy="8" r="4" />
						<path d="M4 21a8 8 0 0 1 16 0" />
					</svg>
				{/if}
			</a>
			<OnlineStatusPicker />
		</span>
	{/if}
{/if}

<style>
	.me {
		position: relative;
		display: inline-flex;
	}

	/* In the top bar: a round button the size of the others beside it. */
	.my-profile {
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

	.my-profile:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	/* In the sidebar: the picture on the left, "My profile" and the status button beside it. */
	.me.wide {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		column-gap: 10px;
		row-gap: 4px;
		padding: 8px 10px;
		border-radius: var(--radius-sm);
	}

	.me.wide:hover {
		background: var(--hover);
	}

	.me.wide.here {
		background: var(--accent-bg);
	}

	.pic {
		position: relative;
		grid-row: 1 / span 2;
		display: inline-grid;
		color: var(--ink-soft);
	}

	.stand-in {
		display: inline-grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--surface);
	}

	/* The status on the picture's corner (colors: --status-* at the top of app.css). */
	.corner {
		position: absolute;
		right: -3px;
		bottom: -3px;
		width: 13px;
		height: 13px;
		border: 2.5px solid var(--paper);
		border-radius: 50%;
		background: var(--status-online);
		background-clip: padding-box;
	}
	.corner.away { background-color: var(--status-away); }
	.corner.dnd { background-color: var(--status-dnd); }
	.corner.invisible { background-color: var(--status-offline); }

	.name {
		color: var(--ink);
		font-size: 0.86rem;
		font-weight: 600;
		text-decoration: none;
		line-height: 1.2;
	}

	.here .name {
		color: var(--accent);
	}
</style>
