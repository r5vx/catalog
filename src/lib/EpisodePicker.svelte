<script lang="ts">
	/**
	 * A show's episodes on a title's page (the computer's version of the TV's): pick a season,
	 * click an episode, and it plays. The same lists as the TV: TMDB's seasons, or the player's
	 * own numbering when it has its own (Bleach is 2 seasons on TMDB, 18 in the player).
	 */
	import { untrack } from 'svelte';
	import { airsText } from '$lib/airs';
	import { playHref } from '$lib/tv/tiles';
	import { warmWhenResting } from '$lib/watch';

	let {
		source,
		sourceId,
		title,
		year = null,
		alt = null
	}: {
		source: string;
		sourceId: string;
		/** The name it plays under (the library's, where it's in the library). */
		title: string;
		year?: number | null;
		/** Its other name, so where it was left off is found under either. */
		alt?: string | null;
	} = $props();

	const watchWarm = warmWhenResting(250);

	type Episode = {
		episode: number;
		name: string;
		still: string | null;
		airDate: string | null;
		runtime: number | null;
		overview: string | null;
		progress: number;
		/** In the player's list but no source has it (yet). */
		missing?: boolean;
	};
	type PlayerList = {
		title: string;
		retryIn?: number;
		seasons: { number: number; count: number }[];
		episodes: { season: number; episode: number; available: boolean; airDate: string | null }[];
	};
	type Show = { showId: number; seasons: { number: number; name: string; count: number }[]; season: number };

	let show = $state<Show | null>(null);
	let playTitle = $state('');
	let playYear = $state('');
	let continuing = $state<{ season: number; episode: number } | null>(null);
	let playerList = $state<PlayerList | null>(null);
	let season = $state(0);
	let episodes = $state<Episode[]>([]);
	let loading = $state(false);
	let row: HTMLElement | undefined = $state();

	// The show's seasons, then (a second later, as on the TV) the player's own list.
	$effect(() => {
		const params = new URLSearchParams({ source, id: sourceId, title, year: String(year ?? ''), alt: alt ?? '' });
		let stale = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		show = null;
		playerList = null;
		episodes = [];

		const useList = (list: PlayerList | null, base: Show) => {
			if (stale || !list?.seasons?.length) return;
			const same =
				list.seasons.length === base.seasons.length &&
				list.seasons.every((s, i) => s.number === base.seasons[i].number && Math.abs(s.count - base.seasons[i].count) <= 2);
			if (same) return;
			playerList = list;
			const resumeSeason = untrack(() => continuing?.season ?? 0);
			// The season being watched, as the player numbers it (Bleach's season 6 isn't on TMDB).
			if (list.seasons.some((s) => s.number === resumeSeason)) season = resumeSeason;
			else if (!list.seasons.some((s) => s.number === untrack(() => season))) season = list.seasons[0].number;
		};

		fetch(`/api/episodes?${params}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((answer) => {
				if (stale || !answer?.show) return;
				const base: Show = answer.show;
				playTitle = answer.playTitle;
				playYear = answer.playYear;
				continuing = answer.continuing;
				show = base;
				season = base.season;
				useList(answer.keptList, base);
				let tries = 0;
				const ask = async () => {
					const list: PlayerList | null = await fetch(`/api/tv/player-episodes?${new URLSearchParams({ title: answer.playTitle, year: answer.playYear })}`)
						.then((r) => (r.ok ? r.json() : null))
						.catch(() => null);
					if (stale) return;
					if (list?.retryIn && ++tries <= 4) timer = setTimeout(ask, Math.min(60, Math.max(5, list.retryIn)) * 1000);
					useList(list, base);
				};
				timer = setTimeout(ask, 1000);
			})
			.catch(() => {});
		return () => {
			stale = true;
			clearTimeout(timer);
		};
	});

	const seasons = $derived(playerList?.seasons ?? show?.seasons ?? []);
	const episodeTitle = $derived(playerList?.title ?? playTitle);

	/** A season of the player's own list: its names as the player shows them, and how far through each. */
	async function playerSeason(list: PlayerList, wanted: number): Promise<Episode[]> {
		const eps = list.episodes.filter((e) => e.season === wanted);
		let before = 0;
		for (const s of list.seasons) if (s.number < wanted) before += s.count;
		const names: Record<number, string> = await fetch(
			`/api/watch/episode-names?${new URLSearchParams({ title: list.title, season: String(wanted), before: String(before), count: String(eps.length) })}`
		)
			.then((r) => (r.ok ? r.json() : {}))
			.catch(() => ({}));
		const watched: { season: number; episode: number; pct: number }[] = await fetch(
			`/api/watch/progress?${new URLSearchParams({ title: list.title, type: 'tv', episodes: '1' })}`
		)
			.then((r) => (r.ok ? r.json() : []))
			.catch(() => []);
		// TMDB's pictures: from its season of the same number and near the same length, or, where
		// TMDB has the whole show as one long season (Re:Zero's 85), counted on from the seasons before.
		const base = untrack(() => show);
		const same = base?.seasons.find((s) => s.number === wanted && Math.abs(s.count - eps.length) <= 2);
		const whole = !same && base?.seasons.length === 1 && base.seasons[0].count >= before + eps.length ? base.seasons[0] : null;
		const from = same ?? whole;
		const tmdb: Episode[] = from
			? await fetch(`/api/tv/season?${new URLSearchParams({ show: String(base!.showId), season: String(from.number) })}`)
					.then((r) => (r.ok ? r.json() : null))
					.then((answer: { episodes?: Episode[] } | null) => answer?.episodes ?? [])
					.catch(() => [])
			: [];
		const offset = whole ? before : 0;
		const tmdbFor = (episode: number) => tmdb.find((t) => t.episode === episode + offset);
		return eps.map((e) => ({
			episode: e.episode,
			name: names[e.episode] ?? `Episode ${e.episode}`,
			still: tmdbFor(e.episode)?.still ?? null,
			airDate: e.airDate,
			runtime: tmdbFor(e.episode)?.runtime ?? null,
			overview: tmdbFor(e.episode)?.overview ?? null,
			progress: Math.min(1, watched.find((w) => w.season === wanted && w.episode === e.episode)?.pct ?? 0),
			missing: !e.available
		}));
	}

	// The picked season's episodes.
	$effect(() => {
		const base = show;
		const wanted = season;
		const list = playerList;
		if (!base || !wanted) return;
		let stale = false;
		loading = true;
		const got = list
			? playerSeason(list, wanted)
			: fetch(`/api/tv/season?${new URLSearchParams({ show: String(base.showId), season: String(wanted), title: untrack(() => playTitle) })}`)
					.then((r) => r.json())
					.then((answer) => (answer.episodes ?? []) as Episode[]);
		got
			.then((eps) => {
				if (!stale) episodes = eps;
			})
			.catch(() => {
				if (!stale) episodes = [];
			})
			.finally(() => {
				if (!stale) loading = false;
			});
		return () => (stale = true);
	});

	// The episode being watched, scrolled into view along the row.
	$effect(() => {
		const at = continuing;
		if (!row || !episodes.length || !at || at.season !== season) return;
		const card = row.querySelector<HTMLElement>(`[data-episode="${at.episode}"]`);
		if (card) row.scrollLeft = card.offsetLeft - row.offsetLeft - 8;
	});

	// Out from 06:00 UTC the day after its US air date (hasAired on the server).
	const aired = (ep: Episode) => !ep.airDate || Date.now() >= Date.parse(`${ep.airDate}T00:00:00Z`) + 30 * 60 * 60 * 1000;
	const isNext = (ep: Episode) => continuing?.season === season && continuing?.episode === ep.episode;

	function scrollBy(direction: number) {
		if (row) row.scrollBy({ left: direction * row.clientWidth * 0.8, behavior: 'smooth' });
	}
</script>

{#if show}
	<section class="episodes">
		<div class="head">
			<h2 class="label">Episodes</h2>
			{#if episodes.length > 4}
				<span class="arrows">
					<button type="button" class="arrow" aria-label="Earlier episodes" onclick={() => scrollBy(-1)}>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
					</button>
					<button type="button" class="arrow" aria-label="Later episodes" onclick={() => scrollBy(1)}>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
					</button>
				</span>
			{/if}
		</div>

		{#if seasons.length > 1}
			<div class="seasons">
				{#each seasons as one (one.number)}
					<button type="button" class="chip" class:on={season === one.number} onclick={() => (season = one.number)}>
						Season {one.number}
					</button>
				{/each}
			</div>
		{/if}

		{#if episodes.length}
			<ul class="row" bind:this={row}>
				{#each episodes as ep (ep.episode)}
					<li data-episode={ep.episode}>
						{#if aired(ep) && !ep.missing}
							<a
								class="ep"
								class:next={isNext(ep)}
								href={playHref(episodeTitle, 'tv', playYear || null, season, ep.episode)}
								title={ep.overview ?? undefined}
								onpointerenter={() => watchWarm.start({ title: episodeTitle, type: 'tv', year: playYear || null, season, episode: ep.episode })}
								onpointerleave={watchWarm.stop}
							>
								<span class="still">
									{#if ep.still}<img src={ep.still} alt="" loading="lazy" />{/if}
									<span class="play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" /></svg></span>
									{#if ep.progress > 0}
										<span class="bar"><span class="fill" style:width="{Math.max(4, ep.progress * 100)}%"></span></span>
									{/if}
								</span>
								<span class="name">{ep.episode}. {ep.name}</span>
								{#if isNext(ep)}
									<span class="meta next-label">Up next</span>
								{:else if ep.runtime}
									<span class="meta">{ep.runtime} min</span>
								{/if}
							</a>
						{:else}
							<span class="ep later">
								<span class="still"><span class="airs">{ep.airDate && !aired(ep) ? airsText(ep.airDate) : 'Not available'}</span></span>
								<span class="name">{ep.episode}. {ep.name}</span>
							</span>
						{/if}
					</li>
				{/each}
			</ul>
		{:else if loading}
			<p class="note faint">Loading episodes…</p>
		{/if}
	</section>
{/if}

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin: 0 0 10px;
	}
	.label {
		font-family: var(--body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin: 0;
	}
	.arrows {
		display: flex;
		gap: 6px;
	}
	.arrow {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		border: 1px solid var(--rule);
		background: var(--surface);
		color: var(--ink-soft);
		display: grid;
		place-items: center;
		cursor: pointer;
		padding: 0;
	}
	.arrow:hover {
		border-color: var(--accent);
		color: var(--ink);
	}
	.arrow svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* Seasons: a long-running show's many seasons wrap onto more lines. */
	.seasons {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0 0 12px;
	}
	.chip {
		border: 1px solid var(--rule);
		background: var(--surface);
		color: var(--ink-soft);
		border-radius: 999px;
		padding: 4px 12px;
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}
	.chip:hover {
		border-color: var(--rule-firm);
		color: var(--ink);
	}
	.chip.on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
	}

	/* One row of episodes that scrolls along, so a long season doesn't make the page longer. */
	.row {
		list-style: none;
		margin: 0;
		padding: 0 0 6px;
		display: flex;
		gap: 14px;
		overflow-x: auto;
		scroll-snap-type: x proximity;
	}
	li {
		flex: 0 0 220px;
		scroll-snap-align: start;
	}
	.ep {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.still {
		position: relative;
		display: grid;
		place-items: center;
		aspect-ratio: 16 / 9;
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--surface-2);
		border: 1px solid var(--rule);
		transition: border-color 0.14s ease;
	}
	.still img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	a.ep:hover .still,
	a.ep:focus-visible .still,
	.ep.next .still {
		border-color: var(--accent);
	}
	.play {
		position: relative;
		width: 38px;
		height: 38px;
		border-radius: 50%;
		background: rgb(0 0 0 / 55%);
		display: grid;
		place-items: center;
		opacity: 0;
		transition: opacity 0.14s ease;
	}
	.play svg {
		width: 18px;
		height: 18px;
		fill: #fff;
	}
	a.ep:hover .play,
	a.ep:focus-visible .play {
		opacity: 1;
	}
	.bar {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 4px;
		background: rgb(0 0 0 / 45%);
	}
	.fill {
		display: block;
		height: 100%;
		background: var(--accent);
	}
	.name {
		font-size: 0.84rem;
		font-weight: 600;
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.meta {
		font-size: 0.75rem;
		color: var(--ink-faint);
	}
	.next-label {
		color: var(--accent);
		font-weight: 600;
	}
	.later {
		opacity: 0.55;
	}
	.airs {
		font-size: 0.78rem;
		color: var(--ink-soft);
		padding: 0 10px;
		text-align: center;
	}
	.note {
		font-size: 0.85rem;
		margin: 0;
	}
</style>
