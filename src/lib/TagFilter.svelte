<script lang="ts">
	type Tag = { id: number; name: string; kind: string; count: number };

	type Props = {
		tags: Tag[];
		/** Tag ids currently applied. */
		selected: number[];
		onchange: (ids: number[]) => void;
	};

	let { tags, selected, onchange }: Props = $props();

	const KIND_LABELS: Record<string, string> = {
		genre: 'Genres',
		studio: 'Studios',
		director: 'Directors & creators',
		franchise: 'Franchises',
		other: 'Other'
	};

	let open = $state(false);
	let filter = $state('');
	let panel = $state<HTMLDivElement | null>(null);
	/** Groups start closed — you pick a category first, then a tag in it. */
	let expanded = $state<Record<string, boolean>>({});

	const chosen = $derived(tags.filter((t) => selected.includes(t.id)));

	/**
	 * Typing narrows the list, which is the point — there are hundreds of tags
	 * and scrolling one enormous dropdown was unusable.
	 */
	const groups = $derived.by(() => {
		const needle = filter.trim().toLowerCase();
		const matching = needle
			? tags.filter((t) => t.name.toLowerCase().includes(needle))
			: tags;

		return ['genre', 'studio', 'director', 'franchise', 'other']
			.map((kind) => ({
				kind,
				label: KIND_LABELS[kind],
				items: matching.filter((t) => t.kind === kind)
			}))
			.filter((group) => group.items.length > 0);
	});

	function toggle(id: number) {
		onchange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
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
		class:on={chosen.length > 0}
		aria-expanded={open}
		onclick={(e) => {
			e.stopPropagation();
			open = !open;
			filter = '';
		}}
	>
		{chosen.length > 0 ? `${chosen.length} filter${chosen.length === 1 ? '' : 's'}` : 'Filter'}
		<span class="caret" aria-hidden="true">▾</span>
	</button>

	{#if open}
		<div class="panel">
			<input
				type="search"
				class="find"
				placeholder="Find a tag…"
				bind:value={filter}
				aria-label="Find a tag"
			/>

			<div class="list">
				{#each groups as group (group.kind)}
					{@const isOpen = expanded[group.kind] || filter.trim().length > 0}
					<button
						type="button"
						class="group"
						aria-expanded={isOpen}
						onclick={() => (expanded[group.kind] = !expanded[group.kind])}
					>
						<span class="arrow" class:down={isOpen} aria-hidden="true">▸</span>
						{group.label}
						<span class="count faint tabular">{group.items.length}</span>
					</button>

					{#if isOpen}
						{#each group.items as tag (tag.id)}
							<label class="row">
								<input
									type="checkbox"
									checked={selected.includes(tag.id)}
									onchange={() => toggle(tag.id)}
								/>
								<span class="name">{tag.name}</span>
								<span class="count faint tabular">{tag.count}</span>
							</label>
						{/each}
					{/if}
				{/each}

				{#if groups.length === 0}
					<p class="empty faint">Nothing matches.</p>
				{/if}
			</div>

			{#if chosen.length > 0}
				<button type="button" class="clear" onclick={() => onchange([])}>
					Clear all filters
				</button>
			{/if}
		</div>
	{/if}
</div>

{#if chosen.length > 0}
	<!-- Chips, so what's applied is visible without opening the panel. -->
	<ul class="chips">
		{#each chosen as tag (tag.id)}
			<li>
				<button type="button" onclick={() => toggle(tag.id)} title="Remove this filter">
					{tag.name}
					<span aria-hidden="true">×</span>
				</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.wrap {
		position: relative;
	}

	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}

	.trigger.on {
		border-color: var(--accent);
		color: var(--accent);
	}

	.caret {
		font-size: 0.7rem;
		opacity: 0.7;
	}

	.panel {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 20;
		width: 290px;
		max-width: calc(100vw - 32px);
		background: var(--surface);
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.find {
		font-size: 0.88rem;
		padding: 7px 10px;
	}

	.list {
		max-height: 320px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}

	.group {
		display: flex;
		align-items: center;
		gap: 7px;
		width: 100%;
		background: none;
		border: none;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--ink-soft);
		padding: 7px 4px;
		margin: 0;
		cursor: pointer;
		text-align: left;
		border-radius: 3px;
	}

	.group:hover {
		background: var(--surface-2);
		color: var(--ink);
	}

	.group .count {
		margin-left: auto;
	}

	.arrow {
		display: inline-block;
		font-size: 0.65rem;
		transition: transform 0.12s ease;
	}

	.arrow.down {
		transform: rotate(90deg);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 4px 5px 20px;
		border-radius: 3px;
		cursor: pointer;
		font-size: 0.88rem;
	}

	.row:hover {
		background: var(--surface-2);
	}

	.row input {
		width: 15px;
		height: 15px;
		accent-color: var(--accent);
		cursor: pointer;
		flex-shrink: 0;
	}

	.row .name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.count {
		font-size: 0.75rem;
	}

	.empty {
		font-size: 0.85rem;
		padding: 10px 4px;
		margin: 0;
	}

	.clear {
		background: none;
		border: none;
		border-top: 1px solid var(--rule);
		padding: 8px 4px 2px;
		color: var(--accent);
		font-size: 0.83rem;
		text-align: left;
		cursor: pointer;
	}

	.chips {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0 0 14px;
		padding: 0;
		width: 100%;
	}

	.chips button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: var(--accent-bg);
		color: var(--accent);
		border: 1px solid var(--accent);
		border-radius: 100px;
		padding: 3px 10px;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.chips button:hover {
		background: var(--accent);
		color: var(--accent-ink);
	}
</style>
