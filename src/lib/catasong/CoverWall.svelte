<script lang="ts">
	/*
	 * The background of Catasong's pages: real covers (album art or anime posters) in tilted rows
	 * drifting sideways, dimmed under the page's colors. Fixed behind everything.
	 */
	let { covers, tall = false }: { covers: string[]; tall?: boolean } = $props();

	const ROWS = 5;
	const rows = $derived.by(() => {
		if (!covers.length) return [];
		const out: string[][] = [];
		for (let r = 0; r < ROWS; r++) {
			const row: string[] = [];
			for (let i = 0; i < 12; i++) row.push(covers[(r * 7 + i * 3) % covers.length]);
			out.push([...row, ...row]);
		}
		return out;
	});
</script>

<div class="wall" class:tall aria-hidden="true">
	<div class="tilt">
		{#each rows as row, r (r)}
			<div class="row" style="animation-duration: {70 + r * 12}s; animation-direction: {r % 2 ? 'reverse' : 'normal'}">
				{#each row as cover, i (i)}
					<img src={cover} alt="" loading="lazy" decoding="async" />
				{/each}
			</div>
		{/each}
	</div>
	<div class="shade"></div>
</div>

<style>
	.wall {
		position: fixed;
		inset: 0;
		z-index: 0;
		overflow: hidden;
		pointer-events: none;
		background: var(--paper);
	}
	.tilt {
		position: absolute;
		inset: -30% -20%;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 14px;
		transform: rotate(-9deg);
		opacity: 0.32;
		filter: saturate(1.2) blur(1px);
	}
	.row {
		display: flex;
		gap: 14px;
		width: max-content;
		animation: drift linear infinite;
	}
	img {
		width: 150px;
		height: 150px;
		object-fit: cover;
		border-radius: 10px;
		flex: none;
	}
	.tall img {
		width: 120px;
		height: 170px;
	}
	.shade {
		position: absolute;
		inset: 0;
		background:
			radial-gradient(ellipse at 20% 0%, color-mix(in srgb, var(--cs-hot) 38%, transparent), transparent 55%),
			radial-gradient(ellipse at 90% 30%, color-mix(in srgb, var(--cs-deep) 40%, transparent), transparent 60%),
			linear-gradient(180deg, color-mix(in srgb, var(--paper) 55%, transparent), var(--paper) 85%);
		transition: background 0.6s ease;
	}
	@keyframes drift {
		to {
			transform: translateX(-50%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.row {
			animation: none;
		}
	}
</style>
