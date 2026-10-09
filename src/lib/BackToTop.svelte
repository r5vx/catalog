<!-- "↑ Back to top", once you've scrolled a fair way down. Same look as the one on Browse. -->
<script lang="ts">
	let show = $state(false);
</script>

<svelte:window onscroll={() => (show = window.scrollY > 600)} />

{#if show}
	<button type="button" class="back-to-top" onclick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
		↑ Back to top
	</button>
{/if}

<style>
	.back-to-top {
		position: fixed;
		bottom: 28px;
		right: 28px;
		z-index: 50;
		padding: 10px 18px;
		border-radius: 100px;
		border: 1px solid var(--rule);
		background: var(--surface);
		color: var(--ink);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
		display: flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}

	.back-to-top:hover {
		background: var(--accent);
		color: var(--accent-ink);
		border-color: var(--accent);
	}
</style>
