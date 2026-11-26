<script lang="ts">
	/**
	 * The online status, like Discord's (owner, 2026-11-25): a dot on the corner of the My profile
	 * picture (src/lib/MyProfileButton.svelte places it), and a click on it picks Online, Away,
	 * Do not disturb or Invisible. Friends see the same dot on this profile's card; Invisible
	 * shows as offline with nothing playing. Kept per profile on the computer
	 * (src/lib/server/online.ts setStatus).
	 */
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';

	let { wide = false }: { wide?: boolean } = $props();

	type Status = 'online' | 'away' | 'dnd' | 'invisible';
	const OPTIONS: { value: Status; name: string; note: string }[] = [
		{ value: 'online', name: 'Online', note: 'Away by itself when Catalog isn’t used for a while' },
		{ value: 'away', name: 'Away', note: '' },
		{ value: 'dnd', name: 'Do not disturb', note: 'No message pop-ups' },
		{ value: 'invisible', name: 'Invisible', note: 'Friends see you as offline, and not what you’re watching' }
	];

	/** Picked here just now (the page's data catches up after). */
	let picked = $state<Status | null>(null);
	const status = $derived<Status>(picked ?? ((page.data.onlineStatus as Status | undefined) ?? 'online'));
	const current = $derived(OPTIONS.find((o) => o.value === status) ?? OPTIONS[0]);

	let open = $state(false);
	let button = $state<HTMLElement | null>(null);
	let menuEl = $state<HTMLElement | null>(null);
	/**
	 * Where the menu goes, worked out when it opens: it's fixed to the window, so the sidebar
	 * (which scrolls, and is narrower than the menu) can't cut it off.
	 */
	let place = $state('');

	function toggle() {
		if (open) {
			open = false;
			return;
		}
		const box = button?.getBoundingClientRect();
		if (!box) return;
		const width = Math.min(280, window.innerWidth - 32);
		if (wide) {
			// The sidebar's is at the bottom of the screen: up from the dot.
			place = `left:${Math.max(16, box.left - 12)}px;bottom:${window.innerHeight - box.top + 8}px;width:${width}px`;
		} else {
			// The top bar's: down from the dot, its right edge at the dot's (kept on screen).
			const left = Math.min(window.innerWidth - width - 16, Math.max(16, box.right - width));
			place = `left:${left}px;top:${box.bottom + 8}px;width:${width}px`;
		}
		open = true;
	}

	async function choose(value: Status) {
		open = false;
		if (value === status) return;
		const before = status;
		picked = value;
		const ok = await fetch('/api/online', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'status', status: value })
		})
			.then((r) => r.ok)
			.catch(() => false);
		if (!ok) picked = before;
		else await invalidateAll().catch(() => {});
	}

	// Closed by a click anywhere else, Escape, or the page scrolling away from it.
	$effect(() => {
		if (!open) return;
		const away = (e: PointerEvent) => {
			const target = e.target as Node;
			if (!button?.contains(target) && !menuEl?.contains(target)) open = false;
		};
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') open = false;
		};
		const shut = () => (open = false);
		window.addEventListener('pointerdown', away, true);
		window.addEventListener('keydown', key);
		window.addEventListener('resize', shut);
		window.addEventListener('scroll', shut, true);
		return () => {
			window.removeEventListener('pointerdown', away, true);
			window.removeEventListener('keydown', key);
			window.removeEventListener('resize', shut);
			window.removeEventListener('scroll', shut, true);
		};
	});
</script>

{#if wide}
	<!-- The sidebar: a button that says the status, under "My profile" (the dot on the picture shows it too). -->
	<button type="button" class="status-pill" bind:this={button} aria-haspopup="menu" aria-expanded={open} onclick={toggle}>
		<span class="dot {status}" aria-hidden="true"></span>
		<span>{current.name}</span>
	</button>
{:else}
	<button
		type="button"
		class="status-dot {status}"
		bind:this={button}
		title="Status: {current.name}"
		aria-label="Status: {current.name}"
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={toggle}
	></button>
{/if}
{#if open}
	<div class="status-menu" role="menu" bind:this={menuEl} style={place}>
		{#each OPTIONS as option (option.value)}
			<button type="button" role="menuitemradio" aria-checked={option.value === status} class:chosen={option.value === status} onclick={() => choose(option.value)}>
				<span class="dot {option.value}" aria-hidden="true"></span>
				<span class="words">
					<span class="option-name">{option.name}</span>
					{#if option.note}<span class="option-note">{option.note}</span>{/if}
				</span>
			</button>
		{/each}
	</div>
{/if}

<style>
	/*
	 * The dot on the corner of the picture, ringed in the page's color as Discord's is. The button is
	 * a little bigger than the dot so it's easier to hit. Colors: --status-* at the top of app.css.
	 */
	.status-dot {
		position: absolute;
		right: -3px;
		bottom: -3px;
		z-index: 2;
		width: 15px;
		height: 15px;
		padding: 0;
		border: 3px solid var(--paper);
		border-radius: 50%;
		background: var(--status-online);
		background-clip: padding-box;
		cursor: pointer;
	}
	.status-dot:hover {
		box-shadow: 0 0 0 2px var(--accent);
	}

	.status-dot.away,
	.dot.away { background-color: var(--status-away); }
	.status-dot.dnd,
	.dot.dnd { background-color: var(--status-dnd); }
	.status-dot.invisible,
	.dot.invisible { background-color: var(--status-offline); }

	.dot {
		flex: none;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--status-online);
	}

	/* The sidebar's button: a pill with the dot, the status and a little arrow. */
	.status-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		justify-self: start;
		padding: 3px 10px;
		border: 1px solid var(--rule);
		border-radius: 100px;
		background: var(--surface);
		color: var(--ink-soft);
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}
	.status-pill:hover,
	.status-pill[aria-expanded='true'] {
		border-color: var(--rule-firm);
		color: var(--ink);
	}
	.status-pill .dot {
		width: 8px;
		height: 8px;
	}

	.status-menu {
		position: fixed;
		z-index: 3000;
		padding: 6px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: var(--shadow);
	}

	.status-menu button {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		width: 100%;
		padding: 8px 10px;
		border: 0;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.status-menu button .dot { margin-top: 5px; }
	.status-menu button:hover { background: var(--hover); }
	.status-menu button.chosen { background: var(--accent-bg); }

	.words { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.option-name { font-size: 0.9rem; font-weight: 600; color: var(--ink); }
	.option-note { font-size: 0.78rem; line-height: 1.35; color: var(--ink-faint); }
</style>
