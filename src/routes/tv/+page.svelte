<script lang="ts">
	import { isWatched } from '$lib/constants';
import TvScreen from '$lib/tv/TvScreen.svelte';
	import { fromContinue, fromLibrary, fromResult, type TileRow } from '$lib/tv/tiles';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** A library title's synopsis, for the banner over Continue Watching. */
	const overviewOf = (title: string) =>
		data.library.find((item) => item.title.toLowerCase() === title.toLowerCase())?.overview ?? null;

	const rows = $derived<TileRow[]>([
		{ label: 'Continue Watching', tiles: data.continueWatching.map((item) => fromContinue(item, overviewOf(item.title))) },
		{ label: 'Watching', tiles: data.library.filter((item) => item.status === 'watching').map(fromLibrary) },
		{ label: 'Want to watch', tiles: data.library.filter((item) => item.status === 'planned').map(fromLibrary) },
		// The 40 watched most lately: all of them (hundreds) would weigh a TV down.
		{ label: 'Watch again', tiles: data.library.filter((item) => isWatched(item.status)).slice(0, 40).map(fromLibrary) }
	]);

	const later = $derived(
		data.shelves.then((shelves) => shelves.map((shelf) => ({ label: shelf.label, tiles: shelf.results.map(fromResult) })))
	);
</script>

<svelte:head><title>Catalog</title></svelte:head>

<TvScreen {rows} {later} />
