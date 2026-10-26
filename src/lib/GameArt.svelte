<script lang="ts">
	/**
	 * A Live TV game's picture: both teams' logos over their colors (server/teamArt.ts), a
	 * replay's own picture, or else a photo of its sport (static/sports/, from Wikimedia Commons;
	 * no emoji anywhere in Catalog, the owner's rule). Big enough to tell games apart without reading.
	 */
	import { sportPicture, scoreText, type GameArt, type GameScore, type Sport } from '$lib/live';

	let {
		art = null,
		sport,
		poster = null,
		score = null
	}: { art?: GameArt | null; sport: Sport; poster?: string | null; score?: GameScore | null } = $props();

	let posterFailed = $state(false);
	let logoFailed = $state(false);
</script>

<span class="art" aria-hidden="true">
	{#if poster && !posterFailed}
		<img class="poster" src={poster} alt="" loading="lazy" onerror={() => (posterFailed = true)} />
	{:else if art && !logoFailed}
		{#each art.teams as team, i (i)}
			<span class="side" style:--team={team.color}>
				<img src={team.logo} alt="" loading="lazy" onerror={() => (logoFailed = true)} />
			</span>
		{/each}
		{#if score && score.state !== 'pre'}
			<span class="score">
				<span class="score-num">{scoreText(score)}</span>
				<span class="score-detail">{score.detail}</span>
			</span>
		{:else}
			<span class="vs">vs</span>
		{/if}
	{:else}
		<img class="poster sport" src={sportPicture(sport)} alt="" loading="lazy" />
	{/if}
</span>

<style>
	.art {
		position: relative;
		display: flex;
		aspect-ratio: 16 / 9;
		width: 100%;
		overflow: hidden;
		border-radius: inherit;
		background: #0e1013;
		container-type: inline-size;
	}

	.poster {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.side {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		background: radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--team) 85%, transparent) 0%, color-mix(in srgb, var(--team) 35%, transparent) 55%, transparent 80%);
	}

	.side img {
		width: 62%;
		height: 62%;
		object-fit: contain;
		filter: drop-shadow(0 2px 6px rgb(0 0 0 / 0.45));
	}

	.vs {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		font-size: max(9px, 5cqw);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: rgb(255 255 255 / 0.75);
	}

	/* The score, big enough to read from across the room. */
	.score {
		position: absolute;
		left: 50%;
		bottom: 6%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 1.5cqw 4cqw;
		border-radius: 3cqw;
		background: rgb(0 0 0 / 0.72);
		color: #fff;
		line-height: 1.1;
		white-space: nowrap;
	}

	.score-num {
		font-size: max(11px, 9cqw);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.score-detail {
		font-size: max(8px, 4.2cqw);
		opacity: 0.8;
	}

	/* A little dimmed, so it reads as a picture of the sport rather than of this game. */
	.sport {
		filter: brightness(0.82) saturate(0.95);
	}
</style>
