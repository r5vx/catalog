<script lang="ts">
	import { SORTS, SORT_GROUPS, sortLabel } from '$lib/constants';

	/**
	 * Sorting, grouped behind a disclosure.
	 *
	 * There are fifteen orders now — your own ratings, four outside scores, and
	 * facts about the title. A flat dropdown made the useful ones hard to find,
	 * so each group opens on its own.
	 */
	let {
		value,
		hidden = [],
		onchange
	}: {
		value: string;
		/** Sort options turned off in Personalization. */
		hidden?: string[];
		onchange: (next: string) => void;
	} = $props();

	// The one in use stays listed even if it's hidden, so an active sort is
	// never something you can see the effect of but not the name of.
	const shown = $derived(SORTS.filter((one) => !hidden.includes(one.value) || one.value === value));

	const groups = $derived(
		SORT_GROUPS.filter((group) => shown.some((one) => one.group === group.key))
	);

	let open = $state(false);
	let panel = $state<HTMLDivElement | null>(null);

	/** The group holding the current choice starts open. */
	const currentGroup = $derived(SORTS.find((one) => one.value === value)?.group ?? 'yours');

	let expanded = $state<Record<string, boolean>>({});

	const isOpen = (key: string) => expanded[key] ?? key === currentGroup;

	function pick(next: string) {
		onchange(next);
		open = false;
	}

	function onWindowClick(event: MouseEvent) {
		if (!open) return;
		if (panel && !panel.contains(event.target as Node)) open = false;
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<div class="wrap" bind:this={panel}>
	<button
		type="button"
		class="btn trigger"
		aria-expanded={open}
		onclick={(e) => {
			e.stopPropagation();
			open = !open;
		}}
	>
		<span class="what">{sortLabel(value)}</span>
		<span class="caret" aria-hidden="true">▾</span>
	</button>

	{#if open}
		<div class="panel">
			{#each groups as group (group.key)}
				{@const showing = isOpen(group.key)}
				<button
					type="button"
					class="group"
					aria-expanded={showing}
					onclick={() => (expanded[group.key] = !showing)}
				>
					<span class="arrow" class:down={showing} aria-hidden="true">▸</span>
					{group.label}
				</button>

				{#if showing}
					<ul>
						{#each shown.filter((one) => one.group === group.key) as option (option.value)}
							<li>
								<button
									type="button"
									class="option"
									class:picked={option.value === value}
									onclick={() => pick(option.value)}
								>
									{option.label}
									{#if option.value === value}<span class="tick" aria-hidden="true">✓</span>{/if}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.wrap {
		position: relative;
	}

	.trigger {
		gap: 6px;
		max-width: 100%;
	}

	.what {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.caret {
		font-size: 0.7em;
		color: var(--ink-faint);
	}

	.panel {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 20;
		min-width: 232px;
		max-height: 70vh;
		overflow-y: auto;
		background: var(--surface);
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 6px;
	}

	.group {
		display: flex;
		align-items: center;
		gap: 7px;
		width: 100%;
		background: none;
		border: none;
		padding: 7px 8px;
		cursor: pointer;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--ink-faint);
		text-align: left;
	}

	.group:hover {
		color: var(--ink);
	}

	.arrow {
		display: inline-block;
		transition: transform 0.14s ease;
		font-size: 0.85em;
	}

	.arrow.down {
		transform: rotate(90deg);
	}

	ul {
		list-style: none;
		margin: 0 0 4px;
		padding: 0;
	}

	.option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		width: 100%;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		padding: 7px 10px 7px 24px;
		cursor: pointer;
		font-size: 0.88rem;
		text-align: left;
		color: var(--ink-soft);
	}

	.option:hover {
		background: var(--surface-2);
		color: var(--ink);
	}

	.option.picked {
		background: var(--accent-bg);
		color: var(--accent);
		font-weight: 600;
	}

	.tick {
		font-size: 0.8em;
	}
</style>
