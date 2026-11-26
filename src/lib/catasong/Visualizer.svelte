<script lang="ts">
	/*
	 * Bars drawn from the sound itself while it plays (the player's analyser); low and still
	 * when nothing does. Colors come from the page's --cs-hot and --cs-deep.
	 */
	import type { SongPlayer } from './player.svelte';

	let { player, bars = 40 }: { player: SongPlayer; bars?: number } = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);

	$effect(() => {
		const el = canvas;
		if (!el) return;
		const draw = el.getContext('2d')!;
		const heights = new Array(bars).fill(0);
		let frame = 0;

		const paint = () => {
			const width = el.clientWidth;
			const height = el.clientHeight;
			const scale = window.devicePixelRatio || 1;
			if (el.width !== Math.round(width * scale)) {
				el.width = Math.round(width * scale);
				el.height = Math.round(height * scale);
			}
			draw.setTransform(scale, 0, 0, scale, 0, 0);
			draw.clearRect(0, 0, width, height);

			const style = getComputedStyle(el);
			const hot = style.getPropertyValue('--cs-hot').trim() || '#e994c2';
			const deep = style.getPropertyValue('--cs-deep').trim() || '#8a6bff';
			const gradient = draw.createLinearGradient(0, height, 0, 0);
			gradient.addColorStop(0, deep);
			gradient.addColorStop(1, hot);
			draw.fillStyle = gradient;

			const data = new Uint8Array(player.analyser?.frequencyBinCount ?? 0);
			if (player.playing && player.analyser) player.analyser.getByteFrequencyData(data);
			const gap = 3;
			const barWidth = (width - gap * (bars - 1)) / bars;
			for (let i = 0; i < bars; i++) {
				// Low notes take most of the bins: spread the bars over the lower two thirds.
				const bin = Math.floor((i / bars) ** 1.4 * data.length * 0.66);
				const target = player.playing ? (data[bin] ?? 0) / 255 : 0;
				heights[i] += (target - heights[i]) * (target > heights[i] ? 0.6 : 0.12);
				const h = Math.max(3, heights[i] * height);
				const x = i * (barWidth + gap);
				draw.beginPath();
				draw.roundRect(x, height - h, barWidth, h, Math.min(3, barWidth / 2));
				draw.fill();
			}
			frame = requestAnimationFrame(paint);
		};
		frame = requestAnimationFrame(paint);
		return () => cancelAnimationFrame(frame);
	});
</script>

<canvas bind:this={canvas} class="visualizer" aria-hidden="true"></canvas>

<style>
	.visualizer {
		display: block;
		width: 100%;
		height: 64px;
	}
</style>
