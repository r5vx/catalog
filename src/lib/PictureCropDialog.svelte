<script lang="ts">
	/**
	 * A picture just chosen, moved and zoomed in its frame before it's used (as Discord does for a
	 * profile picture). Apply hands back how it should sit (src/lib/pictureFit.ts); the caller draws it.
	 */
	import PictureAdjust from '$lib/PictureAdjust.svelte';
	import { DEFAULT_FIT, type Fit } from '$lib/pictureFit';

	let {
		src,
		title = 'Adjust the picture',
		round = false,
		aspect = 1,
		onapply,
		oncancel
	}: { src: string; title?: string; round?: boolean; aspect?: number; onapply: (fit: Fit) => void; oncancel: () => void } = $props();

	let fit = $state<Fit>({ ...DEFAULT_FIT });

	function key(event: KeyboardEvent) {
		if (event.key === 'Escape') oncancel();
	}
</script>

<svelte:window onkeydown={key} />

<div class="backdrop" role="presentation" onclick={oncancel}></div>
<div class="dialog" role="dialog" aria-modal="true" aria-label={title}>
	<h2>{title}</h2>
	<PictureAdjust {src} bind:fit {round} {aspect} width={260} />
	<div class="actions">
		<button type="button" class="btn" onclick={oncancel}>Cancel</button>
		<button type="button" class="btn btn-primary" onclick={() => onapply(fit)}>Apply</button>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: rgb(0 0 0 / 55%);
	}

	.dialog {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 1001;
		transform: translate(-50%, -50%);
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 20px 22px;
		border: 1px solid var(--rule);
		border-radius: 12px;
		background: var(--surface);
		box-shadow: var(--shadow), 0 20px 50px -20px rgb(0 0 0 / 50%);
	}

	h2 {
		margin: 0;
		font-size: 1.05rem;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
