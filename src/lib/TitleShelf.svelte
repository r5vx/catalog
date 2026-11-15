<script lang="ts">
	import { goto } from '$app/navigation';
	import ContextMenu, { menuAt, type MenuItem } from '$lib/ContextMenu.svelte';
	import { titleHref, watchHref, wantToWatch } from '$lib/friendLinks';

	/**
	 * A row (or grid) of posters from a friend's profile or library: each opens the title's page,
	 * and right-click offers Open, Watch and Add to Want to watch.
	 */
	type Item = { key: string; title: string; year?: string; type?: string; poster?: string; rating?: number | null; status?: string; season?: number; episode?: number };

	let { items, grid = false, onadded }: { items: Item[]; grid?: boolean; onadded?: (title: string, ok: boolean) => void } = $props();

	let menu = $state<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);

	function open(event: MouseEvent, item: Item) {
		const list: MenuItem[] = [
			{ label: 'Open', run: () => goto(titleHref(item.key)) },
			...(item.type ? [{ label: 'Watch', run: () => goto(watchHref({ title: item.title, type: item.type!, year: item.year, season: item.season, episode: item.episode })) }] : []),
			{ label: 'Add to Want to watch', run: () => void wantToWatch(item).then((ok) => onadded?.(item.title, ok)) }
		];
		menu = { at: menuAt(event, list.length), items: list };
	}
</script>

<ul class:grid>
	{#each items as item (item.key)}
		<li>
			<a href={titleHref(item.key)} oncontextmenu={(e) => open(e, item)} title={item.title}>
				{#if item.poster}<img src={item.poster} alt="" loading="lazy" />{:else}<span class="empty">{item.title}</span>{/if}
				<span class="name">{item.title}</span>
				<span class="faint small">
					{#if item.episode}<span class="episode tabular">S{item.season}E{item.episode}</span> · {/if}{item.year ?? ''}{#if item.rating != null}<span class="rating tabular"> · ★ {item.rating}/10</span>{/if}
				</span>
			</a>
		</li>
	{/each}
</ul>

{#if menu}<ContextMenu at={menu.at} items={menu.items} close={() => (menu = null)} />{/if}

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0 0 6px;
		display: flex;
		gap: 14px;
		overflow-x: auto;
	}

	ul.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
		overflow: visible;
	}

	li {
		flex: 0 0 130px;
		min-width: 0;
	}

	a {
		display: flex;
		flex-direction: column;
		gap: 4px;
		color: var(--ink);
		text-decoration: none;
	}

	img,
	.empty {
		width: 100%;
		aspect-ratio: 2 / 3;
		border-radius: var(--radius-sm);
		object-fit: cover;
		background: var(--sunk);
		border: 1px solid var(--rule);
		transition: border-color 0.14s ease;
	}

	.empty {
		display: grid;
		place-items: center;
		padding: 8px;
		text-align: center;
		font-size: 0.8rem;
		color: var(--ink-faint);
	}

	a:hover img,
	a:hover .empty {
		border-color: var(--accent);
	}

	.name {
		font-size: 0.85rem;
		font-weight: 600;
		line-height: 1.25;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.small {
		font-size: 0.78rem;
	}

	.rating {
		color: var(--ink-soft);
	}

	.episode {
		color: var(--ink);
		font-weight: 600;
	}
</style>
