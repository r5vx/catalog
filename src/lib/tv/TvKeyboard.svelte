<script lang="ts">
	/**
	 * The TV's own keyboard: the TV app can't count on the TV's keyboard popping up, and a
	 * grid of letters is quicker with a remote anyway (Netflix's works the same way). The
	 * arrows move between keys, OK types one.
	 */
	let {
		value = $bindable(''),
		keys = 'abcdefghijklmnopqrstuvwxyz1234567890',
		columns = 6,
		autofocus = true
	}: { value?: string; keys?: string; columns?: number; autofocus?: boolean } = $props();
</script>

<div class="keyboard" data-tv-row data-tv-grid style:--columns={columns}>
	<button type="button" class="key wide" data-tv-item onclick={() => (value += ' ')}>Space</button>
	<button type="button" class="key wide" data-tv-item onclick={() => (value = value.slice(0, -1))} aria-label="Delete">
		⌫ Delete
	</button>
	<!-- It starts on A, like Netflix's. -->
	{#each keys.split('') as key, i (key)}
		<button
			type="button"
			class="key"
			data-tv-item
			data-tv-autofocus={(autofocus && i === 0) || undefined}
			onclick={() => (value += key)}>{key.toUpperCase()}</button
		>
	{/each}
	<button type="button" class="key wide clear" data-tv-item onclick={() => (value = '')}>Clear</button>
</div>

<style>
	.keyboard {
		display: grid;
		grid-template-columns: repeat(var(--columns), 4vw);
		gap: 0.5vw;
	}

	.key {
		height: 4vw;
		border: none;
		border-radius: 0.5vw;
		background: var(--surface-2);
		color: var(--ink);
		font: inherit;
		font-size: 1.6vw;
		font-weight: 700;
		cursor: pointer;
		outline: none;
		transition: transform 0.1s ease;
	}

	.key.wide {
		grid-column: span 3;
		font-size: 1.25vw;
	}

	.key.clear {
		grid-column: span 6;
	}

	/* Highlighted: white, like the menu. */
	.key:focus,
	.key:global(.tv-focused) {
		background: var(--ink);
		color: var(--paper);
		transform: scale(1.06);
	}
</style>
