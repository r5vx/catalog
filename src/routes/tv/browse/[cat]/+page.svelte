<script lang="ts">
	import { isWatched } from '$lib/constants';
import TvScreen from '$lib/tv/TvScreen.svelte';
	import { fromLibrary, fromResult, type TileRow } from '$lib/tv/tiles';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const rows = $derived<TileRow[]>([
		{ label: 'Watching', tiles: data.library.filter((item) => item.status === 'watching').map(fromLibrary) },
		{ label: 'Want to watch', tiles: data.library.filter((item) => item.status === 'planned').map(fromLibrary) },
		{ label: 'Watched', tiles: data.library.filter((item) => isWatched(item.status)).map(fromLibrary) }
	]);

	const later = $derived(
		data.shelves.then((shelves) => shelves.map((shelf) => ({ label: shelf.label, tiles: shelf.results.map(fromResult) })))
	);
</script>

<svelte:head><title>{data.name} · Catalog</title></svelte:head>

{#key data.name}
	<TvScreen {rows} {later} />
{/key}
