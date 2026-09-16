<script lang="ts">
	import { libraryHref } from '$lib/nav';

	/**
	 * Where you came from, and a way straight out.
	 *
	 * The chain film → actor → film → actor can run as deep as you like, and
	 * walking back up it one step at a time is tedious — so Home is always
	 * there, and it returns to the library as you left it rather than the top.
	 */
	let {
		href = null,
		label = 'Back'
	}: {
		/** Where "back" goes. Falls back to the library you came from. */
		href?: string | null;
		label?: string;
	} = $props();

	let library = $state('/');

	$effect(() => {
		library = libraryHref();
	});

	const backTo = $derived(href ?? library);
	const backLabel = $derived(href ? label : 'Library');

	// No point offering both when back already goes there.
	const showHome = $derived(Boolean(href));
</script>

<nav class="bar">
	<a href={backTo} class="faint">&larr; {backLabel}</a>
	{#if showHome}
		<a href={library} class="faint home">Library</a>
	{/if}
</nav>

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 14px;
		margin-bottom: 14px;
		font-size: 0.85rem;
	}

	a:hover {
		color: var(--accent);
	}

	.home::before {
		content: '';
		display: inline-block;
		width: 1px;
		height: 0.9em;
		background: var(--rule-firm);
		margin-right: 14px;
		vertical-align: -0.1em;
	}
</style>
