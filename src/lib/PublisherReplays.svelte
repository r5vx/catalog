<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { appleMobile, catalogDesktop } from './youtubeDevice';
	import { onReachBottom } from './infiniteScroll';
	let { filters, counts }: { filters:string; counts?:(counts:Record<string,number>) => void } = $props();
	type Card = { id:string; title:string; event:string; kind:string; date:string; upload:string; year:number; channel:string; poster:string };
	const when = (date: string) => { const d = new Date(date + "T12:00:00"); return isNaN(+d) ? date : d.toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" }); };
	let cards = $state<Card[]>([]), next = $state<number|null>(null), failed = $state(false), busy = $state(true);
	let offset = $state(0), retry = $state(0), device = $state('other');
	onMount(() => { device = appleMobile(navigator.userAgent,navigator.maxTouchPoints) ? 'apple' : catalogDesktop(navigator.userAgent) ? 'desktop' : 'other'; });
	$effect(() => {
		const controller = new AbortController();
		const at = offset; void retry;
		busy = true; failed = false;
		fetch(`/api/live/replays?publisher=1&${filters}&offset=${at}`, { signal:controller.signal }).then(async r => {
			if (!r.ok) throw Error();
			const page = await r.json();
			if (controller.signal.aborted) return;
			cards = at ? [...untrack(() => cards), ...page.items] : page.items;
			next = page.next; counts?.(page.counts);
		}).catch(() => { if (!controller.signal.aborted) failed = true; }).finally(() => { if (!controller.signal.aborted) busy = false; });
		return () => controller.abort();
	});
	/** More come by themselves as the list nears the bottom of the screen (as Browse does). */
	function more() {
		if (!busy && !failed && next !== null) offset = next;
	}
</script>

<section aria-label="Publisher replays">
	<h2>From sports channels</h2>
	{#if cards.length}
		<ul data-tv-row data-tv-grid>
			{#each cards as card (card.id)}
				{@const href = device === 'apple' ? `/api/youtube/play?scope=replay&open=1&v=${card.id}` : device === 'desktop' ? `/watch?publisherReplay=${card.id}` : undefined}
				<li><a {href} rel={device === 'apple' ? 'external' : undefined} aria-disabled={!href} data-tv-item tabindex={href ? undefined : 0}>
					<img src={card.poster} alt="" loading="lazy" width="320" height="180" />
					<span class="kind">{card.kind}</span><strong title={card.upload}>{card.title}</strong><small>{card.event ? card.event + " · " : ""}{when(card.date)}</small>
					{#if device === 'other'}<small>Plays on the computer, iPhone or iPad</small>{/if}
				</a></li>
			{/each}
		</ul>
	{/if}
	{#if failed}<p>Couldn’t load these replays. <button type="button" data-tv-item onclick={() => retry++}>Retry</button></p>
	{:else if busy}<p>Loading channel replays…</p>
	{:else if !cards.length}<p>No matching channel replays.</p>{/if}
	{#if next !== null && !failed && !busy}{#key cards.length}<div class="more-sentinel" use:onReachBottom={more} aria-hidden="true"></div>{/key}{/if}
</section>
<style>
	section { margin-top:2rem; } h2 { font-size:1.15rem; }
	ul { padding:0; list-style:none; display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,13rem),1fr)); gap:1rem; }
	a { display:grid; align-content:start; gap:.35rem; text-decoration:none; color:inherit; border-radius:.5rem; }
	a[href]:hover strong { text-decoration:underline; } img { width:100%; height:auto; aspect-ratio:16/9; object-fit:cover; border-radius:.5rem; background:#23252b; }
	small,p { color:var(--muted,#aaa); } button { padding:.45rem .8rem; } .more-sentinel { height:1px; }
	.kind { justify-self:start; font-size:.72rem; font-weight:700; letter-spacing:.04em; text-transform:uppercase; padding:.15rem .5rem; border-radius:999px; background:var(--accent-bg,#2c1a1d); color:var(--accent,#e994c2); }
</style>
