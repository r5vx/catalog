<script lang="ts">
	import { page } from '$app/state';
	import { libraryHref } from '$lib/nav';
	import { p } from '$lib/altText';
	import { safeBack } from '$lib/back';

	let {
		href = null,
		label = 'Back'
	}: {
		href?: string | null;
		label?: string;
	} = $props();
	const pm = $derived(page.data.altMode);

	let library = $state('/?library=1');

	$effect(() => {
		library = libraryHref();
	});

	const previous = $derived(safeBack((page.state as { returnTo?: string }).returnTo ?? null));
	const backTo = $derived(href ?? previous ?? library);
	const backLabel = $derived(href || previous ? (pm ? p(label) : label) : (pm ? p('Library') : 'Library'));
	function goBack(event: MouseEvent) {
		if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		if (previous && previous === backTo) {
			event.preventDefault();
			history.back();
		}
	}

	// No point offering both when back already goes there.
	const showHome = $derived(backTo !== library);
</script>

<nav class="bar">
	<a href={backTo} class="faint" onclick={goBack}>&larr; {backLabel}</a>
	{#if showHome}
		<a href={library} class="faint home">{pm ? p('Library') : 'Library'}</a>
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

	/* On a phone: big enough to hit with a thumb. */
	@media (max-width: 700px) {
		.bar {
			margin: -6px 0 8px;
			font-size: 0.98rem;
		}

		a {
			display: inline-block;
			padding: 8px 0;
		}
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
