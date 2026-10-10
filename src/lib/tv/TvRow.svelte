<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A labelled row of posters on the TV screens; left and right move along it. */
	let { label, children }: { label: string; children: Snippet } = $props();
</script>

<section class="tv-row" data-tv-row>
	<h2>{label}</h2>
	<div class="strip" data-tv-strip>
		{@render children()}
	</div>
</section>

<style>
	.tv-row {
		display: flex;
		flex-direction: column;
		gap: 0.6vw;
	}

	h2 {
		margin: 0;
		font-family: var(--body);
		font-size: 1.7vw;
		font-weight: 700;
		color: var(--ink);
	}

	/* Room above and below for a highlighted poster to grow into; it scrolls by itself. */
	.strip {
		display: flex;
		gap: 1.4vw;
		overflow: hidden;
		padding: 1.4vw 3vw 1.8vw 0.8vw;
		margin-left: -0.8vw;
	}
</style>
