<script lang="ts">
	/**
	 * Live TV on the TV (see /live). Along the top: On now, Your teams, Saved, each sport picked,
	 * Channels, Replays and Search. OK on a game plays it on its best channel (one click); the
	 * remote's menu button opens a box with its other channels, Save and its teams as favorites.
	 * A channel plays straight away. Saving a channel is the star in the player. Back closes the
	 * box first.
	 */
	import { onDestroy, onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import TvKeyboard from '$lib/tv/TvKeyboard.svelte';
	import GameArt from '$lib/GameArt.svelte';
	import { startTvNav, tvFocus } from '$lib/tvNav';
	import {
		SPORTS,
		bestChannel,
		channelsBestFirst,
		countryRank,
		fetchReplays,
		replayLine,
		allCountriesKept,
		keepAllCountries,
		warmReplay,
		freshScores,
		liveKept,
		gameText,
		hasFavorite,
		isOnNow,
		scoreText,
		sendTeam,
		matches,
		replayDay,
		replayHref,
		sendSaved,
		sportLabel,
		watchHref,
		whenText,
		type LiveChannel,
		type LiveGame,
		type LiveReplay,
		type Sport,
		type TeamArt,
		type RecentReplay
	} from '$lib/live';

	type Guide = {
		games: LiveGame[];
		channels: LiveChannel[];
		savedGames: LiveGame[];
		/** The sports this profile picked (null: not asked yet; empty: all of them). */
		sports?: Sport[] | null;
		savedChannels: number[];
		recent: { id: number; name: string }[];
		playable: boolean;
		homeCountry?: string;
		/** Favorite teams: their games first, and under Your teams. */
		teams?: TeamArt[];
		/** Replays watched lately, with how far each got. */
		recentReplays?: RecentReplay[];
	};
	type View = 'now' | 'recent' | 'teams' | 'saved' | 'channels' | 'replays' | 'search' | Sport;

	const KEPT = 'catalog:tvLive';
	const MOST = 90;

	let guide = $state<Guide | null>(liveKept.guide as Guide | null);
	let failed = $state(false);
	let view = $state<View>('now');
	let query = $state('');
	let now = $state(Date.now());
	let open = $state<{ game: LiveGame; from: HTMLElement | null } | null>(null);
	let sheet: HTMLDivElement | undefined = $state();

	let ticker: ReturnType<typeof setInterval> | undefined;
	onMount(async () => {
		try {
			const kept = JSON.parse(sessionStorage.getItem(KEPT) ?? '{}');
			if (kept.view) view = kept.view;
			if (kept.query) query = kept.query;
		} catch {}
		restored = true;
		ticker = setInterval(() => (now = Date.now()), 30_000);
		window.addEventListener('catalog:tv-menu-close', closeGame);
		window.addEventListener('catalog:tv-menu-close', closeSports);
		window.addEventListener('catalog:tv-menu', menuOnGame);
		scorer = setInterval(() => {
			if (guide && !document.hidden) freshScores(guide.games);
		}, 60_000);
		try {
			const resp = await fetch('/api/live/guide');
			if (!resp.ok) throw new Error();
			const fresh = await resp.json();
			liveKept.guide = fresh;
			guide = fresh;
		} catch {
			failed = true;
		}
		// The first time: which sports to show.
		if (guide && guide.sports === null) {
			await openSports();
			return;
		}
		// The chip that was picked, highlighted again (it moved once the sports were known).
		await tick();
		const chip = document.querySelector<HTMLElement>(`[data-view="${view}"]`);
		if (chip && !document.activeElement?.closest('.content')) tvFocus(chip);
	});
	onDestroy(() => {
		clearInterval(ticker);
		if (typeof window !== 'undefined') window.removeEventListener('catalog:tv-menu-close', closeGame);
		if (typeof window !== 'undefined') window.removeEventListener('catalog:tv-menu-close', closeSports);
		if (typeof window !== 'undefined') window.removeEventListener('catalog:tv-menu', menuOnGame);
		clearInterval(scorer);
	});

	/** A chip picked: it shows as picked, and the highlight goes to it (a mouse click left it on the last one). */
	function pick(next: View, event?: MouseEvent) {
		view = next;
		if (event?.currentTarget) tvFocus(event.currentTarget as HTMLElement);
	}

	// Where you were, kept for coming back from a channel (once it's been read back).
	let restored = false;
	$effect(() => {
		const keep = { view, query };
		if (!restored) return;
		try {
			sessionStorage.setItem(KEPT, JSON.stringify(keep));
		} catch {}
	});

	/** Replays of past games: asked for as Live TV opens. */
	let replays = $state<LiveReplay[] | null>(liveKept.replays);
	onMount(() => {
		fetchReplays().then((list) => (replays = list));
	});

	const savedIds = $derived(new Set(guide?.savedGames.map((g) => g.id) ?? []));
	const channelById = $derived(new Map((guide?.channels ?? []).map((c) => [c.id, c])));
	const showingNow = $derived.by(() => {
		const map = new Map<number, LiveGame>();
		for (const game of guide?.games ?? []) {
			if (!isOnNow(game, now)) continue;
			for (const channel of game.channels) if (!map.has(channel.id)) map.set(channel.id, game);
		}
		return map;
	});
	const sportOrder = (s: Sport) => SPORTS.findIndex((x) => x.key === s);

	let scorer: ReturnType<typeof setInterval> | undefined;
	/** Other countries' games too (off: Where to watch's country only; Search finds all). */
	let allCountries = $state(allCountriesKept());
	const isLocal = (g: LiveGame) => g.local !== false || allCountries;
	/** Favorite teams (by ESPN's name): their games first, and under Your teams. */
	const favorites = $derived(new Set((guide?.teams ?? []).map((t) => t.name)));
	const fav = (g: LiveGame) => Number(hasFavorite(g, favorites));
	function toggleTeam(team: TeamArt) {
		if (!guide) return;
		const saved = !favorites.has(team.name);
		guide.teams = saved ? [...(guide.teams ?? []), team] : (guide.teams ?? []).filter((t) => t.name !== team.name);
		sendTeam(team, saved);
	}

	/** One click: a game plays on its best channel. */
	function play(game: LiveGame) {
		const channel = bestChannel(game);
		if (channel) goto(watchHref(channel, game));
	}

	/** The remote's menu button on a game: its box (other channels, Save, its teams). */
	function menuOnGame() {
		const card = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-game]');
		const game = card ? games.find((g) => g.id === card.dataset.game) : null;
		if (card && game) openGame(game, card);
	}
	/** Only the sports this profile picked (asked the first time; "+" changes them). Search covers all. */
	const mine = $derived(guide?.sports?.length ? new Set<string>(guide.sports) : null);
	const isMine = (s: Sport) => !mine || mine.has(s);
	const sportsWithGames = $derived(SPORTS.filter((s) => isMine(s.key) && guide?.games.some((g) => g.sport === s.key && isLocal(g))));

	let pickingSports = $state(false);
	let choice = $state<Sport[]>([]);
	let sportsBox: HTMLDivElement | undefined = $state();

	async function openSports() {
		choice = [...(guide?.sports ?? [])];
		pickingSports = true;
		await tick();
		tvFocus(sportsBox?.querySelector<HTMLElement>('[data-tv-item]') ?? null);
	}

	async function closeSports() {
		if (!pickingSports) return;
		pickingSports = false;
		await tick();
		tvFocus(document.querySelector<HTMLElement>('[data-view="sports"]') ?? document.querySelector<HTMLElement>(`[data-view="${view}"]`));
	}

	function saveSports(list: Sport[]) {
		if (!guide) return;
		guide.sports = list;
		if (typeof view === 'string' && SPORTS.some((x) => x.key === view) && list.length && !list.includes(view as Sport)) view = 'now';
		fetch('/api/live/sports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sports: list }) }).catch(() => {});
		closeSports();
	}

	const toggleSport = (key: Sport) => (choice = choice.includes(key) ? choice.filter((k) => k !== key) : [...choice, key]);

	const games = $derived.by((): LiveGame[] => {
		const all = guide?.games ?? [];
		if (view === 'now') return all.filter((g) => (isMine(g.sport) || fav(g)) && (isLocal(g) || fav(g)) && isOnNow(g, now)).sort((a, b) => fav(b) - fav(a) || sportOrder(a.sport) - sportOrder(b.sport) || a.start - b.start);
		if (view === 'teams') return all.filter((g) => fav(g)).sort((a, b) => Number(isOnNow(b, now)) - Number(isOnNow(a, now)) || a.start - b.start);
		if (view === 'saved') return guide?.savedGames ?? [];
		if (view === 'search') return query.trim().length < 2 ? [] : all.filter((g) => matches(gameText(g), query.trim())).slice(0, 30);
		if (view === 'channels') return [];
		const list = all.filter((g) => g.sport === view && isLocal(g));
		return [...list.filter((g) => isOnNow(g, now)).sort((a, b) => fav(b) - fav(a)), ...list.filter((g) => !isOnNow(g, now)).sort((a, b) => fav(b) - fav(a))];
	});

	const channels = $derived.by((): { id: number; name: string; country?: string }[] => {
		const all = guide?.channels ?? [];
		if (view === 'saved') {
			const saved = (guide?.savedChannels ?? []).map((id) => channelById.get(id) ?? { id, name: `Channel ${id}` });
			const recent = (guide?.recent ?? []).filter((c) => !guide?.savedChannels.includes(c.id));
			return [...saved, ...recent];
		}
		if (view === 'search') return query.trim().length < 2 ? [] : all.filter((c) => matches(c.name, query.trim())).slice(0, 30);
		if (view !== 'channels') return [];
		return all
			.filter((c) => c.sports.length || showingNow.has(c.id))
			.sort(
				(a, b) =>
					Number(showingNow.has(b.id)) - Number(showingNow.has(a.id)) ||
					countryRank(a.country, guide?.homeCountry) - countryRank(b.country, guide?.homeCountry) ||
					a.name.localeCompare(b.name)
			);
	});

	async function openGame(game: LiveGame, from: HTMLElement) {
		open = { game, from };
		await tick();
		tvFocus(sheet?.querySelector<HTMLElement>('[data-tv-item]') ?? null);
	}

	async function closeGame() {
		if (!open) return;
		const from = open.from;
		open = null;
		await tick();
		if (from?.isConnected) tvFocus(from);
		else startTvNav(document.querySelector<HTMLElement>('[data-tv-app]'));
	}

	function toggleSaved(game: LiveGame) {
		if (!guide) return;
		const saved = !savedIds.has(game.id);
		guide.savedGames = saved ? [...guide.savedGames, game].sort((a, b) => a.start - b.start) : guide.savedGames.filter((g) => g.id !== game.id);
		sendSaved({ kind: 'game', game }, saved);
	}

	function watch(channel: { id: number; name: string }, game: LiveGame) {
		open = null;
		goto(watchHref(channel, game));
	}

	const heading = $derived(
		view === 'now' ? 'On now' : view === 'recent' ? 'Recently watched' : view === 'teams' ? 'Your teams' : view === 'saved' ? 'Saved' : view === 'channels' ? 'Channels' : view === 'replays' ? 'Replays' : view === 'search' ? 'Search' : sportLabel(view)
	);
</script>

<svelte:head><title>Live TV · Catalog</title></svelte:head>

{#snippet gameCard(game: LiveGame)}
	{@const on = isOnNow(game, now)}
	<button type="button" class="game" class:on data-tv-item data-game={game.id} onclick={() => play(game)}>
		<span class="art"><GameArt art={game.art} sport={game.sport} poster={game.poster} score={game.score} /></span>
		<span class="when">
			{#if on}<span class="dot"></span>{/if}
			{#if game.score && game.score.state !== 'pre'}{scoreText(game.score)} · {game.score.detail}{:else}{whenText(game, now)}{/if}
			{#if hasFavorite(game, favorites) || savedIds.has(game.id)}<span class="saved-mark">★</span>{/if}
		</span>
		<span class="title">{game.title}</span>
		<span class="league">{[(view === 'now' || view === 'saved' || view === 'search') && sportLabel(game.sport), game.league].filter(Boolean).join(' · ')}</span>
	</button>
{/snippet}

{#snippet channelCard(channel: { id: number; name: string; country?: string })}
	{@const showing = showingNow.get(channel.id)}
	<a class="channel" href={watchHref(channel, showing)} data-tv-item>
		<span class="name">{channel.name}</span>
		{#if showing}<span class="now"><span class="dot"></span>{showing.title}</span>{:else if channel.country}<span class="country">{channel.country}</span>{/if}
	</a>
{/snippet}

<div class="live" inert={!!open || pickingSports}>
	<div class="chips" data-tv-row data-tv-grid>
		<button type="button" class="chip" class:on={view === 'now'} data-view="now" data-tv-item data-tv-autofocus onclick={(e) => pick('now', e)}>On now</button>
		{#if guide?.recentReplays?.length || guide?.recent.length}
			<button type="button" class="chip" class:on={view === 'recent'} data-view="recent" data-tv-item onclick={(e) => pick('recent', e)}>Recently watched</button>
		{/if}
		{#if favorites.size}
			<button type="button" class="chip" class:on={view === 'teams'} data-view="teams" data-tv-item onclick={(e) => pick('teams', e)}>Your teams</button>
		{/if}
		<button type="button" class="chip" class:on={view === 'saved'} data-view="saved" data-tv-item onclick={(e) => pick('saved', e)}>Saved</button>
		{#each sportsWithGames as s (s.key)}
			<button type="button" class="chip" class:on={view === s.key} data-view={s.key} data-tv-item onclick={(e) => pick(s.key, e)}>{s.label}</button>
		{/each}
		<button type="button" class="chip add" data-view="sports" data-tv-item aria-label="Change which sports show" onclick={openSports}>+</button>
		{#if guide?.homeCountry}
			<button type="button" class="chip" class:on={allCountries} aria-pressed={allCountries} data-tv-item onclick={() => keepAllCountries((allCountries = !allCountries))}>Other countries</button>
		{/if}
		<button type="button" class="chip" class:on={view === 'channels'} data-view="channels" data-tv-item onclick={(e) => pick('channels', e)}>Channels</button>
		<button type="button" class="chip" class:on={view === 'replays'} data-view="replays" data-tv-item onclick={(e) => pick('replays', e)}>Replays</button>
		<button type="button" class="chip" class:on={view === 'search'} data-view="search" data-tv-item onclick={(e) => pick('search', e)}>Search</button>
	</div>

	<div class="content">
		{#if !guide}
			<p class="empty">{failed ? "Live TV can't be reached right now." : 'Loading the schedule…'}</p>
		{:else if view === 'recent'}
			<h2>Recently watched</h2>
			{#if guide.recentReplays?.length}
				<div class="grid" data-tv-row data-tv-grid>
					{#each guide.recentReplays as replay (replay.id)}
						<a class="game" href={replayHref(replay)} data-tv-item>
							<span class="art">
								<GameArt sport={replay.sport} poster={replay.poster} />
								{#if replay.duration > 0 && replay.currentTime > 0}
									<span class="watched-bar"><span style:width="{Math.min(100, (replay.currentTime / replay.duration) * 100)}%"></span></span>
								{/if}
							</span>
							<span class="title">{replay.title}</span>
							<span class="league">{replay.duration > 0 && replay.currentTime / replay.duration < 0.95 ? `${Math.max(1, Math.round((replay.duration - replay.currentTime) / 60))} min left` : 'Watched'} · Replay</span>
						</a>
					{/each}
				</div>
			{/if}
			{#if guide.recent.length}
				<div class="grid" data-tv-row data-tv-grid>
					{#each guide.recent as channel (channel.id)}{@render channelCard(channelById.get(channel.id) ?? channel)}{/each}
				</div>
			{/if}
		{:else if view === 'replays'}
			<h2>Replays</h2>
			{#if replays === null}
				<p class="empty">Loading replays…</p>
			{:else if !replays.length}
				<p class="empty">No replays right now.</p>
			{:else}
				<div class="grid" data-tv-row data-tv-grid>
					{#each replays.filter((r) => isMine(r.sport)).slice(0, MOST) as replay (replay.id)}
						<a class="game" href={replayHref(replay)} data-tv-item onfocus={() => warmReplay(replay.id)}>
							<span class="art"><GameArt sport={replay.sport} poster={replay.poster} /></span>
							<span class="title">{replay.title}</span>
							<span class="league">{replayLine(replay)}</span>
						</a>
					{/each}
				</div>
			{/if}
		{:else if view === 'search'}
			<div class="search">
				<div class="keys">
					<p class="typed" class:placeholder={!query}>{query || 'Teams, leagues, channels'}</p>
					<TvKeyboard bind:value={query} />
				</div>
				<div class="results">
					{#if query.trim().length < 2}
						<p class="empty">Type a team, a league or a channel.</p>
					{:else if !games.length && !channels.length}
						<p class="empty">Nothing found for “{query.trim()}”.</p>
					{:else}
						{#if games.length}
							<div class="grid two" data-tv-row data-tv-grid>
								{#each games as game (game.id)}{@render gameCard(game)}{/each}
							</div>
						{/if}
						{#if channels.length}
							<div class="grid two" data-tv-row data-tv-grid>
								{#each channels as channel (channel.id)}{@render channelCard(channel)}{/each}
							</div>
						{/if}
					{/if}
				</div>
			</div>
		{:else}
			<h2>{heading}</h2>
			{#if games.length}
				<div class="grid" data-tv-row data-tv-grid>
					{#each games.slice(0, MOST) as game (game.id)}{@render gameCard(game)}{/each}
				</div>
			{/if}
			{#if channels.length}
				{#if view === 'saved'}<h2>Channels</h2>{/if}
				<div class="grid" data-tv-row data-tv-grid>
					{#each channels.slice(0, MOST * 2) as channel (channel.id)}{@render channelCard(channel)}{/each}
				</div>
			{/if}
			{#if !games.length && !channels.length}
				<p class="empty">
					{view === 'saved' ? 'Nothing saved yet. Open a game and pick Save, or use the star in the player.' : view === 'now' ? 'Nothing on right now.' : 'None right now.'}
				</p>
			{/if}
		{/if}
	</div>
</div>

{#if open}
	{@const game = open.game}
	<div class="sheet" data-tv-sheet>
		<div class="box">
			<p class="sheet-title">{game.title}</p>
			<p class="sheet-sub">{[sportLabel(game.sport), game.league, whenText(game, now)].filter(Boolean).join(' · ')}</p>
			<div class="actions" bind:this={sheet} data-tv-row data-tv-grid>
				{#each channelsBestFirst(game).slice(0, 8) as channel (channel.id)}
					<button type="button" class="action" data-tv-item onclick={() => watch(channel, game)}>Watch on {channel.name}</button>
				{/each}
				<button type="button" class="action save" data-tv-item onclick={() => toggleSaved(game)}>
					{savedIds.has(game.id) ? '★ Saved' : '☆ Save'}
				</button>
				{#each game.art?.teams ?? [] as team (team.name)}
					<button type="button" class="action save" data-tv-item onclick={() => toggleTeam(team)}>
						{favorites.has(team.name) ? `★ ${team.name}` : `☆ Favorite ${team.name}`}
					</button>
				{/each}
			</div>
		</div>
	</div>
{/if}

{#if pickingSports}
	<div class="sheet" data-tv-sheet>
		<div class="box wide">
			<p class="sheet-title">Pick what Live TV shows</p>
			<p class="sheet-sub">Only those show here. Change them any time with +.</p>
			<div class="pick-list" bind:this={sportsBox} data-tv-row data-tv-grid>
				{#each SPORTS as s (s.key)}
					<button type="button" class="pick" class:on={choice.includes(s.key)} aria-pressed={choice.includes(s.key)} data-tv-item onclick={() => toggleSport(s.key)}>
						<span class="pick-art"><GameArt sport={s.key} /></span>
						<span class="pick-name">{choice.includes(s.key) ? '✓ ' : ''}{s.label}</span>
					</button>
				{/each}
			</div>
			<div class="pick-actions" data-tv-row>
				<button type="button" class="action" data-tv-item disabled={!choice.length} onclick={() => saveSports(choice)}>Done</button>
				<button type="button" class="action" data-tv-item onclick={() => saveSports([])}>Every sport</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.box.wide {
		max-width: 80vw;
	}

	.pick-list {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 0.8vw;
	}

	.pick {
		display: flex;
		flex-direction: column;
		gap: 0.4vw;
		padding: 0 0 0.6vw;
		border: 0.2vw solid transparent;
		border-radius: 0.8vw;
		background: var(--paper);
		color: var(--ink-soft);
		font: inherit;
		font-size: 1.3vw;
		font-weight: 600;
		overflow: hidden;
		opacity: 0.55;
		cursor: pointer;
		outline: none;
	}

	.pick.on {
		color: var(--ink);
		opacity: 1;
	}

	.pick:focus,
	.pick:global(.tv-focused) {
		border-color: var(--ink);
		box-shadow: 0 0 0 0.25vw var(--ink);
		opacity: 1;
	}

	.pick-art {
		display: block;
	}

	.pick-actions {
		display: flex;
		gap: 0.8vw;
		margin-top: 0.6vw;
	}

	.live {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		gap: 1.6vw;
		padding: 6vh 3vw 0 1vw;
		overflow-y: auto;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.8vw;
	}

	.chip {
		padding: 0.6vw 1.5vw;
		border: 2px solid var(--rule-firm);
		border-radius: 999px;
		background: transparent;
		color: var(--ink-soft);
		font: inherit;
		font-size: 1.35vw;
		cursor: pointer;
		outline: none;
	}

	/* The one picked: in the accent color, as on the TV's library. */
	.chip.on {
		border-color: var(--accent);
		color: var(--accent);
	}

	.chip:focus,
	.chip:global(.tv-focused) {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--paper);
	}

	h2 {
		margin: 0.6vw 0 0;
		font-size: 2vw;
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: 1.4vw;
		padding-bottom: 6vh;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1vw;
	}

	.grid.two {
		grid-template-columns: repeat(2, 1fr);
	}

	.game,
	.channel {
		display: flex;
		flex-direction: column;
		gap: 0.3vw;
		min-width: 0;
		padding: 1.1vw 1.3vw;
		border: 2px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
		outline: none;
	}

	.game:focus,
	.game:global(.tv-focused),
	.channel:focus,
	.channel:global(.tv-focused) {
		border-color: var(--ink);
		box-shadow: 0 0 0 0.25vw var(--ink);
	}

	.when {
		display: flex;
		align-items: center;
		gap: 0.6vw;
		font-size: 1.15vw;
		color: var(--ink-soft);
	}

	.game.on .when {
		color: var(--accent);
		font-weight: 600;
	}

	/* How far a replay got, along the bottom of its picture. */
	.watched-bar {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 0.35vw;
		background: rgb(0 0 0 / 0.5);
	}

	.watched-bar span {
		display: block;
		height: 100%;
		background: var(--accent);
	}

	/* The game's picture across the top of its box. */
	.game .art {
		position: relative;
		display: block;
		margin: -1.1vw -1.3vw 0.5vw;
		border-radius: calc(var(--radius) - 2px) calc(var(--radius) - 2px) 0 0;
		overflow: hidden;
	}

	.saved-mark {
		margin-left: auto;
		color: var(--star);
	}

	.dot {
		flex: none;
		width: 0.6vw;
		height: 0.6vw;
		border-radius: 50%;
		background: var(--accent);
	}

	.title {
		font-size: 1.45vw;
		font-weight: 600;
		line-height: 1.25;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.league,
	.country {
		font-size: 1.1vw;
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.name {
		font-size: 1.4vw;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.now {
		display: flex;
		align-items: center;
		gap: 0.6vw;
		font-size: 1.1vw;
		color: var(--accent);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.empty {
		font-size: 1.5vw;
		color: var(--ink-faint);
	}

	.search {
		display: flex;
		gap: 3vw;
	}

	.keys {
		flex: none;
		width: 34vw;
	}

	.typed {
		margin: 0 0 1vw;
		font-size: 2vw;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.typed.placeholder {
		color: var(--ink-faint);
	}

	.results {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1vw;
	}

	.sheet {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: grid;
		place-items: center;
		background: rgb(0 0 0 / 55%);
	}

	.box {
		display: flex;
		flex-direction: column;
		gap: 0.8vw;
		min-width: 34vw;
		max-width: 50vw;
		padding: 2vw;
		border-radius: 1vw;
		background: var(--surface);
		box-shadow: 0 1vw 4vw rgb(0 0 0 / 60%);
	}

	.sheet-title {
		margin: 0;
		font-family: var(--display);
		font-size: 2vw;
		font-weight: 600;
	}

	.sheet-sub {
		margin: 0 0 0.6vw;
		font-size: 1.2vw;
		color: var(--ink-faint);
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 0.6vw;
	}

	.action {
		padding: 1vw 1.4vw;
		border: none;
		border-radius: 0.6vw;
		background: rgb(255 255 255 / 8%);
		color: var(--ink);
		font: inherit;
		font-size: 1.5vw;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
		outline: none;
	}

	.action:focus,
	.action:global(.tv-focused) {
		background: var(--ink);
		color: var(--paper);
	}

	.action.save {
		margin-top: 0.6vw;
	}
</style>
