<script lang="ts">
	/**
	 * Season and episode reached, as dropdowns that fit the show: as many seasons as it has, and
	 * as many episodes as the chosen season has (src/lib/server/metadata/seasons.ts). A show with
	 * one season shows only the episode. Without counts (not found yet, or added by hand), plain
	 * number boxes. `seasonName`/`episodeName` put them in a form.
	 */
	type SeasonCount = { season: number; episodes: number };
	type Props = {
		seasons: SeasonCount[] | null;
		season: number | null;
		episode: number | null;
		onchange?: (season: number | null, episode: number | null) => void;
		seasonName?: string;
		episodeName?: string;
	};

	let { seasons, season = $bindable(null), episode = $bindable(null), onchange, seasonName, episodeName }: Props = $props();

	const range = (to: number) => Array.from({ length: Math.max(0, to) }, (_, i) => i + 1);

	// What's already saved stays choosable even past what's listed (a season TMDB lacks yet).
	const seasonOptions = $derived(seasons ? range(Math.max(...seasons.map((s) => s.season), season ?? 0)) : []);
	const oneSeason = $derived(Boolean(seasons && seasons.length === 1 && (season ?? 1) === 1));
	const episodeCount = $derived(seasons?.find((s) => s.season === (oneSeason ? 1 : season))?.episodes ?? 0);
	const episodeOptions = $derived(range(Math.max(episodeCount, episode ?? 0)));

	function changeSeason(value: string) {
		season = value ? Number(value) : null;
		// A new season starts at its first episode; none picked, none either.
		episode = season ? 1 : null;
		onchange?.(season, episode);
	}

	function changeEpisode(value: string) {
		episode = value ? Number(value) : null;
		// One season: the episode is enough.
		if (oneSeason && episode && !season) season = 1;
		onchange?.(season, episode);
	}

	const asNumber = (value: string) => (value.trim() === '' ? null : Math.max(0, Number(value) || 0));
</script>

<div class="progress">
	{#if seasons}
		{#if !oneSeason}
			<label class="pick">
				<span>Season</span>
				<select value={season ?? ''} onchange={(e) => changeSeason(e.currentTarget.value)}>
					<option value="">—</option>
					{#each seasonOptions as n (n)}<option value={n}>{n}</option>{/each}
				</select>
			</label>
		{/if}
		<label class="pick">
			<span>Episode</span>
			<select value={episode ?? ''} onchange={(e) => changeEpisode(e.currentTarget.value)} disabled={!oneSeason && !season}>
				<option value="">—</option>
				{#each episodeOptions as n (n)}<option value={n}>{n}</option>{/each}
			</select>
			{#if episodeCount}<span class="of faint">of {episodeCount}</span>{/if}
		</label>
	{:else}
		<label class="pick">
			<span>Season</span>
			<input type="number" min="0" max="999" placeholder="—" value={season ?? ''}
				onchange={(e) => { season = asNumber(e.currentTarget.value); onchange?.(season, episode); }} />
		</label>
		<label class="pick">
			<span>Episode</span>
			<input type="number" min="0" max="9999" placeholder="—" value={episode ?? ''}
				onchange={(e) => { episode = asNumber(e.currentTarget.value); onchange?.(season, episode); }} />
		</label>
	{/if}
	{#if seasonName}<input type="hidden" name={seasonName} value={season ?? ''} />{/if}
	{#if episodeName}<input type="hidden" name={episodeName} value={episode ?? ''} />{/if}
</div>

<style>
	.progress {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 16px;
	}

	.pick {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.86rem;
		color: var(--ink-soft);
	}

	.pick select,
	.pick input {
		width: auto;
		min-width: 72px;
		padding: 5px 8px;
	}

	.pick input {
		width: 84px;
	}

	.of {
		font-size: 0.8rem;
	}
</style>
