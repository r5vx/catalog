<script lang="ts">
	/*
	 * Catasong's big round Play button. The ring round it fills as the clip plays and empties
	 * the moment it stops (it follows the player, not a timer).
	 */
	import type { SongPlayer } from './player.svelte';

	let {
		player,
		label,
		sub = '',
		disabled = false,
		onclick
	}: { player: SongPlayer; label: string; sub?: string; disabled?: boolean; onclick: () => void } = $props();

	let progress = $state(0);

	$effect(() => {
		if (!player.playing) {
			progress = 0;
			return;
		}
		let frame = 0;
		const tick = () => {
			progress = player.length ? player.elapsed() / player.length : 0;
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	});
</script>

<button type="button" class="play" class:playing={player.playing} {disabled} {onclick} style="--p: {progress}">
	<span class="ring" aria-hidden="true"></span>
	<span class="face">
		{#if player.playing}
			<span class="stop-mark" aria-hidden="true"></span>
		{:else}
			<span class="play-mark" aria-hidden="true"></span>
		{/if}
	</span>
	<span class="words">
		<span class="play-label">{label}</span>
		{#if sub}<span class="sub">{sub}</span>{/if}
	</span>
</button>

<style>
	.play {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 14px;
		padding: 0;
		border: none;
		background: none;
		color: var(--ink);
		cursor: pointer;
		text-align: left;
	}
	.play:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.ring {
		position: absolute;
		left: -5px;
		top: 50%;
		width: 82px;
		height: 82px;
		margin-top: -41px;
		border-radius: 50%;
		background: conic-gradient(var(--cs-hot, var(--accent)) calc(var(--p) * 360deg), color-mix(in srgb, var(--ink) 12%, transparent) 0);
		mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px));
	}
	.face {
		position: relative;
		flex: none;
		width: 72px;
		height: 72px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: linear-gradient(145deg, var(--cs-hot, var(--accent)), var(--cs-deep, var(--logo-dot)));
		box-shadow:
			0 10px 30px -10px var(--cs-hot, var(--accent)),
			inset 0 1px 0 rgb(255 255 255 / 35%);
		transition:
			transform 0.15s ease,
			box-shadow 0.2s ease;
	}
	.play:not(:disabled):hover .face {
		transform: scale(1.06);
		box-shadow:
			0 14px 40px -8px var(--cs-hot, var(--accent)),
			inset 0 1px 0 rgb(255 255 255 / 45%);
	}
	.play:not(:disabled):active .face {
		transform: scale(0.95);
	}
	.play-mark {
		width: 0;
		height: 0;
		margin-left: 5px;
		border-style: solid;
		border-width: 13px 0 13px 21px;
		border-color: transparent transparent transparent #fff;
	}
	.stop-mark {
		width: 20px;
		height: 20px;
		border-radius: 3px;
		background: #fff;
	}
	.words {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.play-label {
		font-family: var(--display);
		font-size: 1.5rem;
		line-height: 1;
	}
	.sub {
		font-size: 0.8rem;
		color: var(--ink-faint);
	}
</style>
