<script lang="ts">
	/**
	 * Settings → TV and phones: Catalog on other screens, and the PIN they're asked for.
	 * Three pages until 2026-11-14 (Watch on TV, Phones, Privacy); each part keeps its own file here.
	 */
	import WatchOnTv from './WatchOnTv.svelte';
	import Phones from './Phones.svelte';
	import Privacy from './Privacy.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>TV and phones · Catalog</title></svelte:head>

<WatchOnTv {data} />
<Phones {data} />
<Privacy {data} {form} />
