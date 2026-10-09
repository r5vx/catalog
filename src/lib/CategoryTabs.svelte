<script lang="ts">
	import MoreButton from '$lib/MoreButton.svelte';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { p } from '$lib/poison';
	import type { Category } from '$lib/server/db/types';

	type Props = {
		categories: Category[];
		countByCategory: Record<number, number>;
		total: number;
		noteCount: number;
		watchingCount?: number;
		friendCount?: number;
		active: string;
		poisonMode?: boolean;
	};

	let { categories, countByCategory, total, noteCount, watchingCount = 0, friendCount = 0, active, poisonMode = false }: Props = $props();
	const pm = $derived(poisonMode);

	/**
	 * Keep sort, search and tag filters when switching category — they're
	 * settings, not something you should have to reapply per tab.
	 */
	function link(slug: string) {
		const params = new URLSearchParams(page.url.search);
		params.delete('cat');
		if (slug) params.set('cat', slug);

		const query = params.toString();
		return query ? `/?${query}` : '/';
	}

	/* ------------------------------------------------ the tabs, in your order */

	type Tab = { key: string; href: string; emoji: string; label: string; count: number | null };

	const allTabs = $derived<Tab[]>([
		{ key: 'all', href: link(''), emoji: '', label: pm ? p('All') : 'All', count: total },
		...(watchingCount > 0
			? [{ key: 'watching', href: link('watching'), emoji: '▶', label: pm ? p('Continue Watching') : 'Continue Watching', count: watchingCount }]
			: []),
		...categories.map((c) => ({ key: c.slug, href: link(c.slug), emoji: c.emoji, label: c.name, count: countByCategory[c.id] ?? 0 })),
		{ key: 'friends', href: link('friends'), emoji: '👥', label: pm ? p('Friends') : 'Friends', count: friendCount || null },
		{ key: 'orders', href: '/orders', emoji: '🗂️', label: 'Watch list', count: null },
		{ key: 'notes', href: '/notes', emoji: '📝', label: pm ? p('Notes') : 'Notes', count: noteCount }
	]);

	// Drag a tab to move it. The order is saved in settings; a tab it doesn't mention
	// (a new category, say) keeps its usual place, after the ones that were moved.
	const savedOrder = $derived<string[]>(page.data.tabOrder ?? []);
	let changedOrder = $state<string[] | null>(null);
	const order = $derived(changedOrder ?? savedOrder);

	const rank = (key: string) => {
		const i = order.indexOf(key);
		return i === -1 ? 1000 + allTabs.findIndex((t) => t.key === key) : i;
	};

	const tabs = $derived(
		allTabs.filter((t) => t.key === 'all' || shown(t.key)).sort((a, b) => rank(a.key) - rank(b.key))
	);

	const isActive = (key: string) => (key === 'all' ? active === '' : active === key);

	let dragging = $state<string | null>(null);
	/** The tab the dragged one would land in front of; '' means at the end. */
	let dropBefore = $state<string | null>(null);

	function onDragStart(e: DragEvent, key: string) {
		dragging = key;
		e.dataTransfer?.setData('text/plain', key);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}

	function onDragOver(e: DragEvent, key: string) {
		if (!dragging) return;
		e.preventDefault();
		// Over the right half of a tab means "after it", i.e. in front of the next one.
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const after = e.clientX > box.left + box.width / 2;
		const i = tabs.findIndex((t) => t.key === key);
		dropBefore = after ? (tabs[i + 1]?.key ?? '') : key;
	}

	async function onDrop(e: DragEvent) {
		e.preventDefault();
		const moving = dragging;
		const before = dropBefore;
		dragging = null;
		dropBefore = null;
		if (!moving || before === null || before === moving) return;

		// Every tab, hidden ones too, so hiding one later doesn't scramble the rest.
		const keys = [...allTabs]
			.sort((a, b) => rank(a.key) - rank(b.key))
			.map((t) => t.key)
			.filter((k) => k !== moving);
		const at = before ? keys.indexOf(before) : -1;
		keys.splice(at === -1 ? keys.length : at, 0, moving);

		changedOrder = keys;
		await fetch('/api/tabs', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ order: keys })
		});
		await invalidateAll(); // so other pages get the new order
		changedOrder = null;
	}

	/** Back to the original order (hidden tabs stay hidden). */
	async function resetOrder() {
		menu = null;
		changedOrder = [];
		await fetch('/api/tabs', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ order: [] })
		});
		await invalidateAll();
		changedOrder = null;
	}

	function onDragEnd() {
		dragging = null;
		dropBefore = null;
	}

	/* ------------------------------------------------ hiding tabs */

	// Right-click a tab to hide it; right-click the empty part of the row to bring tabs back.
	// Saved in settings, so they stay hidden on every device.
	const savedHidden = $derived<string[]>(page.data.hiddenTabs ?? []);
	let changedHidden = $state<string[] | null>(null);
	const hidden = $derived(changedHidden ?? savedHidden);
	const shown = (key: string) => !hidden.includes(key);

	const FIXED_NAMES: Record<string, string> = {
		watching: 'Continue Watching',
		friends: 'Friends',
		orders: 'Watch list',
		notes: 'Notes'
	};
	const nameOf = (key: string) => FIXED_NAMES[key] ?? categories.find((c) => c.slug === key)?.name ?? key;

	async function setHidden(next: string[]) {
		changedHidden = next;
		menu = null;
		await fetch('/api/tabs', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ hidden: next })
		});
		await invalidateAll(); // so the header's tiles and other pages pick it up
		changedHidden = null;
	}

	let menu = $state<{ x: number; y: number; tab: string | null } | null>(null);

	function openMenu(e: MouseEvent, tab: string | null) {
		e.preventDefault();
		e.stopPropagation();
		menu = { x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 200), tab };
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav class="tabs has-more" aria-label="Categories" oncontextmenu={(e) => openMenu(e, null)}>
	{#each tabs as tab (tab.key)}
		<a
			href={tab.href}
			class="tab"
			class:active={isActive(tab.key)}
			class:dragging={dragging === tab.key}
			class:drop-before={dragging && dragging !== tab.key && dropBefore === tab.key}
			draggable="true"
			ondragstart={(e) => onDragStart(e, tab.key)}
			ondragover={(e) => onDragOver(e, tab.key)}
			ondrop={onDrop}
			ondragend={onDragEnd}
			oncontextmenu={tab.key === 'all' ? undefined : (e) => openMenu(e, tab.key)}
		>
			{#if tab.emoji}<span aria-hidden="true">{tab.emoji}</span>{/if}
			{tab.label}
			{#if tab.count !== null}<span class="n tabular">{tab.count}</span>{/if}
		</a>
	{/each}
	{#if !dragging}
		<MoreButton variant="inline" label="Tab options" onopen={(e) => openMenu(e, null)} />
	{/if}
	{#if dragging}
		<!-- The space after the last tab, for moving one to the end. -->
		<span
			class="end-drop"
			class:drop-before={dropBefore === ''}
			role="presentation"
			ondragover={(e) => { e.preventDefault(); dropBefore = ''; }}
			ondrop={onDrop}
		></span>
	{/if}
</nav>

{#if menu}
	{@const tab = menu.tab}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="ctx-backdrop" onclick={() => (menu = null)} oncontextmenu={(e) => { e.preventDefault(); menu = null; }}></div>
	<div class="ctx-menu" style="left: {menu.x}px; top: {menu.y}px;">
		{#if tab}
			<button type="button" onclick={() => setHidden([...hidden, tab])}>Hide “{nameOf(tab)}”</button>
		{:else if hidden.length === 0}
			{#if order.length === 0}<span class="ctx-note">Right-click a tab to hide it, or drag it to move it.</span>{/if}
		{:else}
			{#each hidden as key (key)}
				<button type="button" onclick={() => setHidden(hidden.filter((k) => k !== key))}>Show “{nameOf(key)}”</button>
			{/each}
			{#if hidden.length > 1}
				<hr />
				<button type="button" onclick={() => setHidden([])}>Show all</button>
			{/if}
		{/if}
		{#if order.length > 0}
			{#if tab || hidden.length > 0}<hr />{/if}
			<button type="button" onclick={resetOrder}>Reset tab order</button>
		{/if}
	</div>
{/if}

<style>
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		border-bottom: 1px solid var(--rule);
		padding-bottom: 14px;
		margin-bottom: 14px;
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 100px;
		border: 1px solid transparent;
		color: var(--ink-soft);
		font-size: 0.9rem;
		transition:
			background 0.12s ease,
			color 0.12s ease;
	}

	.tab:hover {
		background: var(--surface-2);
		color: var(--ink);
	}

	.tab.active {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
		font-weight: 600;
	}

	.n {
		font-size: 0.75rem;
		opacity: 0.65;
	}

	.tab.dragging {
		opacity: 0.4;
	}

	/* Where the dragged tab will land: a bar just in front of this one. */
	.drop-before {
		box-shadow: -4px 0 0 -1px var(--accent);
	}

	.end-drop {
		flex: 1;
		min-width: 40px;
		align-self: stretch;
	}

	.ctx-backdrop {
		position: fixed;
		inset: 0;
		z-index: 900;
	}

	.ctx-menu {
		position: fixed;
		z-index: 901;
		min-width: 190px;
		padding: 4px 0;
		background: var(--surface);
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}

	.ctx-menu button {
		display: block;
		width: 100%;
		padding: 8px 14px;
		border: none;
		background: none;
		color: var(--ink);
		text-align: left;
		font-size: 0.88rem;
		cursor: pointer;
	}

	.ctx-menu button:hover {
		background: var(--accent);
		color: var(--accent-ink, #fff);
	}

	.ctx-menu hr {
		border: none;
		border-top: 1px solid var(--rule);
		margin: 4px 0;
	}

	.ctx-note {
		display: block;
		max-width: 230px;
		padding: 8px 14px;
		font-size: 0.88rem;
		color: var(--ink-faint);
	}
</style>
