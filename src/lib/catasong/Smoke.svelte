<script lang="ts">
	/*
	 * Bloodlust's smoke: soft dark-red puffs rising slowly from the bottom of the screen, growing
	 * and fading as they go. Louder music makes more of it and makes it redder (`level`, 0–1).
	 * One puff picture is drawn once (several blurred blobs, so it's lumpy like smoke) and
	 * stamped at many sizes and turns.
	 */
	import type { SongPlayer } from './player.svelte';

	let { player }: { player: SongPlayer } = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);

	type Puff = { x: number; y: number; size: number; grow: number; rise: number; drift: number; turn: number; spin: number; life: number; age: number; red: boolean };

	function puffPicture(color: string): HTMLCanvasElement {
		const sprite = document.createElement('canvas');
		sprite.width = sprite.height = 256;
		const draw = sprite.getContext('2d')!;
		for (let i = 0; i < 9; i++) {
			const x = 128 + (Math.random() - 0.5) * 90;
			const y = 128 + (Math.random() - 0.5) * 90;
			const r = 50 + Math.random() * 60;
			const blob = draw.createRadialGradient(x, y, 0, x, y, r);
			blob.addColorStop(0, color.replace('A', '0.05'));
			blob.addColorStop(0.6, color.replace('A', '0.018'));
			blob.addColorStop(1, color.replace('A', '0'));
			draw.fillStyle = blob;
			draw.fillRect(0, 0, 256, 256);
		}
		return sprite;
	}

	$effect(() => {
		const el = canvas;
		if (!el) return;
		const draw = el.getContext('2d')!;
		const red = puffPicture('rgba(120, 6, 20, A)');
		const grey = puffPicture('rgba(70, 55, 60, A)');
		const puffs: Puff[] = [];
		let frame = 0;
		let last = performance.now();
		let smooth = 0;

		const add = (width: number, height: number, anywhere = false) => {
			// Sized to the window: on a narrow one, big puffs cover everything.
			const size = Math.min(width, 900) * (0.35 + Math.random() * 0.45);
			puffs.push({
				x: Math.random() * width,
				y: anywhere ? height * (0.85 + Math.random() * 0.3) : height + size * 0.3,
				size,
				grow: 10 + Math.random() * 25,
				rise: 14 + Math.random() * 22,
				drift: (Math.random() - 0.5) * 14,
				turn: Math.random() * Math.PI * 2,
				spin: (Math.random() - 0.5) * 0.12,
				life: 14 + Math.random() * 10,
				age: 0,
				red: Math.random() < 0.6
			});
		};

		const paint = (now: number) => {
			const seconds = Math.min(0.05, (now - last) / 1000);
			last = now;
			const width = el.clientWidth;
			const height = el.clientHeight;
			if (el.width !== width || el.height !== height) {
				el.width = width;
				el.height = height;
			}
			if (!puffs.length && height > 200) for (let i = 0; i < 3; i++) add(width, height, true);

			smooth += (player.level() - smooth) * 0.08;
			// More puffs while the music is loud.
			if (puffs.length < 26 && Math.random() < seconds * (0.7 + smooth * 3)) add(width, height);

			draw.clearRect(0, 0, width, height);
			for (let i = puffs.length - 1; i >= 0; i--) {
				const puff = puffs[i];
				puff.age += seconds;
				if (puff.age > puff.life || puff.y < -puff.size) {
					puffs.splice(i, 1);
					continue;
				}
				puff.y -= puff.rise * seconds * (1 + smooth * 1.5);
				puff.x += puff.drift * seconds;
				puff.size += puff.grow * seconds;
				puff.turn += puff.spin * seconds;
				const t = puff.age / puff.life;
				// In softly, out slowly.
				// Thinner as it rises: the top of the page stays clear.
				const low = Math.max(0, Math.min(1, puff.y / height));
				draw.globalAlpha = Math.min(1, t * 5) * (1 - t) * low * (0.6 + smooth * 0.7);
				draw.save();
				draw.translate(puff.x, puff.y);
				draw.rotate(puff.turn);
				draw.drawImage(puff.red || smooth > 0.5 ? red : grey, -puff.size / 2, -puff.size / 2, puff.size, puff.size);
				draw.restore();
			}
			draw.globalAlpha = 1;
			frame = requestAnimationFrame(paint);
		};
		frame = requestAnimationFrame(paint);
		return () => cancelAnimationFrame(frame);
	});
</script>

<canvas bind:this={canvas} class="smoke" aria-hidden="true"></canvas>

<style>
	.smoke {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: 0;
		pointer-events: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.smoke {
			display: none;
		}
	}
</style>
