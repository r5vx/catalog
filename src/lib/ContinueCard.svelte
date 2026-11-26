<script lang="ts">
	import { onDestroy } from 'svelte';
	import { posterSrcset, POSTER_SIZES } from '$lib/poster';
	import { warmUpTitle } from '$lib/watch';
	import PosterPlaceholder from '$lib/PosterPlaceholder.svelte';
	import type { ContinueItem } from '$lib/server/db/queries';

	let { item, href, oncontextmenu }: { item: ContinueItem; href: string; oncontextmenu?: (e: MouseEvent) => void } = $props();
	let timer: ReturnType<typeof setTimeout> | null = null;
	function cancelWarm() { if (timer) clearTimeout(timer); }
	function scheduleWarm() {
		cancelWarm();
		if (!item.needsRelease) timer = setTimeout(() => warmUpTitle(item), 250);
	}
	onDestroy(cancelWarm);
	function progress(current: number, total: number) {
		if (total <= 0) return 'Up next';
		return `${Math.round(current / total * 100)}% · ${Math.max(0, Math.floor((total - current) / 60))}m left`;
	}
</script>

<a {href} class="card" {oncontextmenu} onpointerenter={scheduleWarm} onpointerleave={cancelWarm} onfocus={scheduleWarm} onblur={cancelWarm}>
	<div class="poster">
		{#if item.posterUrl}
			<img src={item.posterUrl} srcset={posterSrcset(item.posterUrl)} sizes={POSTER_SIZES} alt="" loading="lazy" />
		{:else}<PosterPlaceholder title={item.title} kind={item.type === 'tv' ? 'TV' : 'Film'} />{/if}
		<span class="watching-progress-overlay"><span class="watching-fill" style:width={`${item.duration > 0 ? Math.min(100, Math.round(item.currentTime / item.duration * 100)) : 0}%`}></span></span>
	</div>
	<div class="meta">
		<h3 class="card-title">{item.title}</h3>
		<p class="sub faint tabular">{item.type === 'tv' ? `S${item.season}E${item.episode} · ` : ''}{item.needsRelease ? 'Choose release' : progress(item.currentTime, item.duration)}</p>
	</div>
</a>

<style>
	.card { display: flex; flex-direction: column; gap: 9px; min-width: 0; }
	.poster { position: relative; aspect-ratio: 2 / 3; max-width: 100%; background: var(--surface-2); border: 1px solid var(--rule); border-radius: var(--radius); overflow: hidden; display: grid; place-items: center; transition: border-color 0.14s ease, transform 0.14s ease; }
	.card:hover .poster { border-color: var(--accent); transform: translateY(-2px); }
	.poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
	.poster-fallback { font-size: 2rem; opacity: 0.4; }
	.watching-progress-overlay { position: absolute; bottom: 0; left: 0; right: 0; height: 4px; background: rgb(0 0 0 / 40%); }
	.watching-fill { display: block; height: 100%; background: var(--accent); }
	.meta { display: flex; flex-direction: column; gap: 4px; container-type: inline-size; }
	.card-title { font-family: var(--body); font-size: 0.92rem; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
	.sub { font-size: 0.78rem; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	@media (max-width: 560px) { .card-title { font-size: 0.86rem; } .meta, .sub { font-size: 0.72rem; } }
</style>
