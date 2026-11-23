<script lang="ts">
	/**
	 * Moving and zooming a picture in its frame, as Discord does: drag it to move it, the slider (or
	 * the mouse wheel) to zoom, Reset to put it back. `fit` (src/lib/pictureFit.ts) is what's
	 * picked; `onchange` comes when a drag or a zoom ends, for saving.
	 */
	import { DEFAULT_FIT, MAX_ZOOM, fitStyle, type Fit } from '$lib/pictureFit';

	let {
		src,
		fit = $bindable({ ...DEFAULT_FIT }),
		aspect = 1,
		round = false,
		width = 220,
		onchange
	}: { src: string; fit?: Fit; aspect?: number; round?: boolean; width?: number; onchange?: (fit: Fit) => void } = $props();

	const height = $derived(Math.round(width / aspect));
	let dragging: { x: number; y: number; from: Fit } | null = null;

	function down(event: PointerEvent) {
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		dragging = { x: event.clientX, y: event.clientY, from: { ...fit } };
	}

	function move(event: PointerEvent) {
		if (!dragging) return;
		// Dragging right shows more of the picture's left: the point in the middle moves left. The
		// more it's zoomed, the less a drag moves it, so it follows the pointer.
		const dx = ((event.clientX - dragging.x) / width) * (100 / dragging.from.zoom);
		const dy = ((event.clientY - dragging.y) / height) * (100 / dragging.from.zoom);
		fit = { ...fit, x: Math.min(100, Math.max(0, dragging.from.x - dx)), y: Math.min(100, Math.max(0, dragging.from.y - dy)) };
	}

	function up() {
		if (!dragging) return;
		dragging = null;
		onchange?.(fit);
	}

	let wheelTimer: ReturnType<typeof setTimeout> | undefined;
	function wheel(event: WheelEvent) {
		event.preventDefault();
		fit = { ...fit, zoom: Math.min(MAX_ZOOM, Math.max(1, Math.round((fit.zoom - event.deltaY / 500) * 100) / 100)) };
		clearTimeout(wheelTimer);
		wheelTimer = setTimeout(() => onchange?.(fit), 400);
	}

	function reset() {
		fit = { ...DEFAULT_FIT };
		onchange?.(fit);
	}
</script>

<div class="adjust">
	<div
		class="frame"
		class:round
		style:width="{width}px"
		style:height="{height}px"
		role="slider"
		tabindex="-1"
		aria-label="Drag to move the picture"
		aria-valuenow={Math.round(fit.x)}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		onwheel={wheel}
	>
		<div class="picture" style="background-image: url('{src}'); {fitStyle(fit)}"></div>
	</div>
	<div class="controls" style:width="{width}px">
		<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
		<input type="range" min="1" max={MAX_ZOOM} step="0.01" bind:value={fit.zoom} onchange={() => onchange?.(fit)} aria-label="Zoom" />
		<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="3" /></svg>
	</div>
	<div class="row">
		<span class="faint small">Drag to move</span>
		<button type="button" class="link" onclick={reset}>Reset</button>
	</div>
</div>

<style>
	.adjust {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.frame {
		position: relative;
		overflow: hidden;
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius);
		background: var(--sunk);
		cursor: grab;
		touch-action: none;
		user-select: none;
	}

	.frame:active {
		cursor: grabbing;
	}

	.frame.round {
		border-radius: 50%;
	}

	.picture {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--ink-faint);
	}

	.controls input {
		flex: 1;
		accent-color: var(--accent);
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.small {
		font-size: 0.8rem;
	}

	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--accent);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}
</style>
