<script lang="ts">
	/**
	 * "More like this" under a title (src/lib/server/recommendations.ts says where it comes
	 * from). Asked for once the page is up, so it never holds the page back; nothing shows if
	 * there's nothing to suggest. Right-click a card for the same menu as Browse's.
	 */
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';

	type Suggestion = {
		source: string;
		sourceId: string;
		title: string;
		year: number | null;
		posterUrl: string | null;
		kind: string;
		why?: string;
		watched?: boolean;
		watching?: boolean;
		entryId?: number;
		more?: boolean;
	};

	let { source, sourceId, title = '' }: { source: string; sourceId: string; title?: string } = $props();

	let items = $state<Suggestion[]>([]);
	let loading = $state(true);
	// How many of the looser matches "Show more" has added.
	let extra = $state(0);
	const STEP = 10;

	// Remembered on this computer.
	const WATCHED_KEY = 'catalog:recsShowWatched';
	let showWatched = $state(true);
	try {
		showWatched = localStorage.getItem(WATCHED_KEY) !== '0';
	} catch {}
	let rowEl: HTMLElement | undefined = $state();
	function toggleWatched() {
		showWatched = !showWatched;
		try {
			localStorage.setItem(WATCHED_KEY, showWatched ? '1' : '0');
		} catch {}
		// Back to the start of the row once the cards have changed: turned on, the watched ones
		// come back in before where it was scrolled to (Frieren, first in the row, was left
		// off-screen to the left).
		tick().then(() => rowEl?.scrollTo({ left: 0 }));
	}

	// Hiding the ones already seen (watched or being watched) fills the row back up from the
	// looser matches, so it keeps its length.
	const seenIt = (s: Suggestion) => Boolean(s.watched || s.watching);
	const kept = $derived(items.filter((s) => showWatched || !seenIt(s)));
	const rowLength = $derived(items.filter((s) => !s.more).length + extra);
	const shown = $derived(kept.slice(0, rowLength));

	$effect(() => {
		const params = new URLSearchParams({ source, id: sourceId, title });
		let stale = false;
		items = [];
		extra = 0;
		loading = true;
		fetch(`/api/recommendations?${params}`)
			.then((r) => (r.ok ? r.json() : []))
			.then((list: Suggestion[]) => {
				if (!stale) items = list;
			})
			.catch(() => {})
			.finally(() => {
				if (!stale) loading = false;
			});
		return () => (stale = true);
	});

	/* ------------------------------------------------ right-click */

	let menu = $state<{ x: number; y: number; item: Suggestion } | null>(null);
	let problem = $state('');

	function openMenu(e: MouseEvent, item: Suggestion) {
		e.preventDefault();
		menu = { x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 220), item };
	}
	const closeMenu = () => (menu = null);

	const watchType = (s: Suggestion) => (s.source === 'tmdb' ? (s.sourceId.startsWith('movie:') ? 'movie' : 'tv') : s.kind === 'Movie' ? 'movie' : 'tv');
	const watchLink = (s: Suggestion) =>
		`/watch?title=${encodeURIComponent(s.title)}&type=${watchType(s)}${s.year ? `&year=${s.year}` : ''}&auto=1`;

	async function add(item: Suggestion, status: 'completed' | 'watching' | 'planned') {
		closeMenu();
		problem = '';
		try {
			const response = await fetch('/api/add', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ source: item.source, sourceId: item.sourceId, status })
			});
			if (!response.ok) {
				problem = 'That could not be added. Try again in a moment.';
				return;
			}
			const added = (await response.json()) as { id?: number };
			// Marked at once, as the library now has it.
			items = items.map((s) =>
				s === item ? { ...s, entryId: added.id ?? s.entryId, watched: status === 'completed', watching: status === 'watching' } : s
			);
		} catch {
			problem = 'That could not be added — no connection.';
		}
	}
</script>

{#if loading || items.length}
	<section class="more-like">
		<div class="head">
			<h2>More like this</h2>
			<button type="button" class="switch" role="switch" aria-checked={showWatched} onclick={toggleWatched}>
				<span class="track" class:on={showWatched}><span class="knob"></span></span>
				<span class="switch-label">Show watched</span>
			</button>
		</div>
		{#if problem}<p class="problem">{problem}</p>{/if}
		{#if loading}
			<div class="row" aria-hidden="true">
				{#each Array.from({ length: 6 }) as _, i (i)}<div class="card ghost"><div class="poster"></div></div>{/each}
			</div>
		{:else}
			<div class="row" bind:this={rowEl}>
				{#each shown as item (`${item.source}:${item.sourceId}`)}
					<a class="card" href="/title/{item.source}/{item.sourceId}" oncontextmenu={(e) => openMenu(e, item)}>
						<div class="poster">
							{#if item.posterUrl}<img src={item.posterUrl} alt="" loading="lazy" />{:else}<span class="empty">?</span>{/if}
						</div>
						<span class="name">{item.title}</span>
						<span class="meta faint">{[item.year, item.why ?? item.kind].filter(Boolean).join(' · ')}</span>
						{#if item.watched}<span class="mark">Watched</span>{:else if item.watching}<span class="mark">Watching</span>{/if}
					</a>
				{/each}
				{#if kept.length > shown.length}
					<button type="button" class="card more-button" onclick={() => (extra += STEP)}>
						<span class="poster"><span class="plus">+</span></span>
						<span class="name">Show more</span>
					</button>
				{/if}
			</div>
			{#if !shown.length}<p class="faint none">All of these are watched.</p>{/if}
		{/if}
	</section>
{/if}

{#if menu}
	<div class="ctx-backdrop" role="presentation" onclick={closeMenu} oncontextmenu={(e) => { e.preventDefault(); closeMenu(); }}></div>
	<div class="ctx-menu" style="left: {menu.x}px; top: {menu.y}px;">
		<button type="button" onclick={() => { goto(watchLink(menu!.item)); closeMenu(); }}>▶ Watch</button>
		<button type="button" onclick={() => { goto(`/title/${menu!.item.source}/${menu!.item.sourceId}`); closeMenu(); }}>View details</button>
		<hr />
		{#if menu.item.entryId}
			<button type="button" onclick={() => { goto(`/entry/${menu!.item.entryId}`); closeMenu(); }}>View entry</button>
		{:else}
			<button type="button" onclick={() => add(menu!.item, 'completed')}>✓ Add as completed</button>
			<button type="button" onclick={() => add(menu!.item, 'watching')}>Add as watching</button>
			<button type="button" onclick={() => add(menu!.item, 'planned')}>Add to watchlist</button>
		{/if}
	</div>
{/if}

<style>
	.more-like {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 28px;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 16px;
		border-bottom: 1px solid var(--rule);
		padding-bottom: 8px;
	}

	h2 {
		font-size: 1.1rem;
		margin: 0;
	}

	/* An on/off switch: the knob slides right and the track fills in when it's on. */
	.switch {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.84rem;
		color: var(--ink-soft, var(--ink));
		cursor: pointer;
	}

	.track {
		position: relative;
		width: 34px;
		height: 20px;
		border-radius: 999px;
		background: var(--rule);
		transition: background 0.15s ease;
		flex: none;
	}

	.track.on {
		background: var(--accent);
	}

	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 3px rgb(0 0 0 / 30%);
		transition: transform 0.15s ease;
	}

	.track.on .knob {
		transform: translateX(14px);
	}

	.switch:focus-visible .track {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.problem {
		margin: 0;
		font-size: 0.84rem;
		color: var(--danger, #c33);
	}

	.row {
		display: flex;
		gap: 14px;
		overflow-x: auto;
		padding-bottom: 8px;
		scroll-snap-type: x proximity;
		/* Cards coming back in don't drag the scroll along with them. */
		overflow-anchor: none;
	}

	.card {
		flex: 0 0 132px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		color: inherit;
		text-decoration: none;
		scroll-snap-align: start;
	}

	.poster {
		aspect-ratio: 2 / 3;
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--sunk);
		display: grid;
		place-items: center;
	}

	.poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 0.15s ease;
	}

	.card:hover .poster img {
		transform: scale(1.04);
	}

	.empty {
		color: var(--ink-faint);
		font-size: 1.4rem;
	}

	.name {
		font-size: 0.86rem;
		font-weight: 600;
		line-height: 1.25;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.meta {
		font-size: 0.76rem;
	}

	.mark {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--good);
	}

	.more-button {
		font: inherit;
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		text-align: left;
	}

	.more-button .poster {
		border: 1px dashed var(--rule);
		background: transparent;
	}

	.more-button:hover .poster {
		border-color: var(--accent);
	}

	.plus {
		font-size: 2rem;
		color: var(--ink-faint);
	}

	.none {
		margin: 0;
		font-size: 0.86rem;
	}

	.ghost .poster {
		animation: pulse 1.2s ease-in-out infinite alternate;
	}

	@keyframes pulse {
		to {
			opacity: 0.5;
		}
	}

	/* The right-click menu, as on Browse. */
	.ctx-backdrop {
		position: fixed;
		inset: 0;
		z-index: 900;
	}

	.ctx-menu {
		position: fixed;
		z-index: 901;
		min-width: 180px;
		background: var(--surface, #1e1e1e);
		border: 1px solid var(--rule, #333);
		border-radius: var(--radius-sm, 6px);
		padding: 4px 0;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}

	.ctx-menu button {
		display: block;
		width: 100%;
		padding: 8px 14px;
		border: none;
		background: none;
		color: var(--ink, #ddd);
		text-align: left;
		font-size: 0.84rem;
		cursor: pointer;
	}

	.ctx-menu button:hover {
		background: var(--accent);
		color: var(--accent-ink, #fff);
	}

	.ctx-menu hr {
		border: none;
		border-top: 1px solid var(--rule, #333);
		margin: 4px 0;
	}

	@media (max-width: 600px) {
		.card {
			flex-basis: 108px;
		}
	}
</style>
