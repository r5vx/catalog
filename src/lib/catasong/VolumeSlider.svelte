<script lang="ts">
	/* Catasong's volume, kept on the computer (setting catasongVolume) so it's the same next time. */
	import type { SongPlayer } from './player.svelte';

	let { player }: { player: SongPlayer } = $props();

	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	function change(event: Event) {
		player.setVolume(Number((event.currentTarget as HTMLInputElement).value));
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			void fetch('/api/catasong', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ volume: player.volume })
			}).catch(() => null);
		}, 400);
	}
</script>

<label class="volume" style="--v: {player.volume}">
	<span class="word">Volume</span>
	<input type="range" min="0" max="1" step="0.01" value={player.volume} oninput={change} aria-label="Volume" />
	<span class="amount tabular">{Math.round(player.volume * 100)}</span>
</label>

<style>
	.volume {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 0.8rem;
		color: var(--ink-faint);
	}
	.amount {
		width: 2.2em;
		text-align: right;
	}
	input {
		appearance: none;
		width: 110px;
		height: 6px;
		border-radius: 3px;
		background: linear-gradient(90deg, var(--cs-hot, var(--accent)) calc(var(--v) * 100%), color-mix(in srgb, var(--ink) 15%, transparent) 0);
		cursor: pointer;
	}
	input::-webkit-slider-thumb {
		appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 0 0 3px var(--cs-hot, var(--accent));
	}
	input::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border: none;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 0 0 3px var(--cs-hot, var(--accent));
	}
</style>
