<script lang="ts">
	/**
	 * Live TV (sources/daddylive.ts): games from the schedule, by sport, with the channels showing
	 * each; the 24/7 channels; and what's saved. The star saves a game (to watch later) or a
	 * channel. Played through this computer, so it works on the phone and TVs too, but only while
	 * the desktop app runs (it reads each channel's stream out of sight).
	 *
	 * With every sport showing, each sport gets a few games (on now first) and "See all"; with one
	 * picked, its games go by On now, Later today, Tomorrow.
	 */
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import LiveStar from '$lib/LiveStar.svelte';
	import GameArt from '$lib/GameArt.svelte';
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
		itemWord,
		matches,
		replayDay,
		replayHref,
		scoreText,
		sendSaved,
		sendForget,
		sendTeam,
		sportLabel,
		timeGroup,
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
		/** Favorite teams: their games first, under "Your teams". */
		teams?: TeamArt[];
		/** Replays watched lately, with how far each got. */
		recentReplays?: RecentReplay[];
		/** The sports this profile picked (null: not asked yet; empty: all of them). */
		sports?: Sport[] | null;
		savedChannels: number[];
		recent: { id: number; name: string }[];
		playable: boolean;
		homeCountry?: string;
	};
	type Tab = 'games' | 'channels' | 'replays' | 'saved';

	const KEPT = 'catalog:live';
	/** Games shown for each sport with every sport showing; channels shown before "Show all". */
	const PER_SPORT = 5;
	const PER_SECTION = 40;
	const CHANNELS_SHOWN = 120;

	let guide = $state<Guide | null>(liveKept.guide as Guide | null);
	let failed = $state(false);
	let tab = $state<Tab>('games');
	let sport = $state<Sport | 'all'>('all');
	let league = $state('');
	let country = $state('');
	/** A country picked this visit ("Every country" included); otherwise Where to watch's. */
	let countryPicked = false;
	let search = $state('');
	let now = $state(Date.now());
	/** Games showing all their channels, and lists showing everything. */
	let opened = $state<string[]>([]);
	let expanded = $state<string[]>([]);

	// Where you were, kept for coming back from a channel (read once the page is showing).
	let restored = $state(false);
	$effect(() => {
		// The country only once picked by hand: otherwise it's Where to watch's again next time.
		const picked = country;
		const keep = { tab, sport, country: countryPicked ? picked : undefined };
		if (!restored) return;
		try {
			sessionStorage.setItem(KEPT, JSON.stringify(keep));
		} catch {}
	});

	async function load() {
		try {
			const resp = await fetch('/api/live/guide');
			if (!resp.ok) throw new Error();
			const fresh = await resp.json();
			liveKept.guide = fresh;
			guide = fresh;
			if (!countryPicked && guide?.homeCountry) country = guide.homeCountry;
			failed = false;
			// No games at all is never the real schedule: asked again soon, not in ten minutes.
			if (!fresh?.games?.length && emptyTries++ < 6) setTimeout(load, 20_000);
		} catch {
			if (!guide) failed = true;
		}
	}
	let emptyTries = 0;

	let ticker: ReturnType<typeof setInterval> | undefined;
	let reloader: ReturnType<typeof setInterval> | undefined;
	onMount(() => {
		try {
			const kept = JSON.parse(sessionStorage.getItem(KEPT) ?? '{}');
			if (kept.tab) tab = kept.tab;
			if (kept.sport) sport = kept.sport;
			if (typeof kept.country === 'string') {
				country = kept.country;
				countryPicked = true;
			}
		} catch {}
		restored = true;
		load();
		ticker = setInterval(() => (now = Date.now()), 30_000);
		reloader = setInterval(load, 10 * 60_000);
		scorer = setInterval(() => {
			if (guide && !document.hidden) freshScores(guide.games);
		}, 60_000);
	});
	let scorer: ReturnType<typeof setInterval> | undefined;
	onDestroy(() => {
		clearInterval(ticker);
		clearInterval(reloader);
		clearInterval(scorer);
	});

	/** Favorite teams (by ESPN's name): their games come first, and under "Your teams". */
	const favorites = $derived(new Set((guide?.teams ?? []).map((t) => t.name)));
	const yourTeams = $derived(
		(guide?.games ?? [])
			.filter((g) => hasFavorite(g, favorites) && (!searched || matches(gameText(g), searched)))
			.sort((a, b) => Number(isOnNow(b, now)) - Number(isOnNow(a, now)) || a.start - b.start)
	);
	function toggleTeam(team: TeamArt) {
		if (!guide) return;
		const saved = !favorites.has(team.name);
		guide.teams = saved ? [...(guide.teams ?? []), team] : (guide.teams ?? []).filter((t) => t.name !== team.name);
		sendTeam(team, saved);
	}
	const favoritesFirst = (list: LiveGame[]) => [...list].sort((a, b) => Number(hasFavorite(b, favorites)) - Number(hasFavorite(a, favorites)));

	/** Replays of past games (sources/replays.ts): asked for as Live TV opens. */
	let replays = $state<LiveReplay[] | null>(liveKept.replays);
	onMount(() => {
		fetchReplays().then((list) => (replays = list));
	});
	const replaysFound = $derived(
		(replays ?? []).filter((r) => isMine(r.sport) && (sport === 'all' || r.sport === sport) && (!searched || matches(`${r.title} ${r.league}`, searched)))
	);

	const savedGameIds = $derived(new Set(guide?.savedGames.map((g) => g.id) ?? []));
	const savedChannelIds = $derived(new Set(guide?.savedChannels ?? []));
	const channelById = $derived(new Map((guide?.channels ?? []).map((c) => [c.id, c])));

	/** What each channel is showing now, from the schedule. */
	const showingNow = $derived.by(() => {
		const map = new Map<number, LiveGame>();
		for (const game of guide?.games ?? []) {
			if (!isOnNow(game, now)) continue;
			for (const channel of game.channels) if (!map.has(channel.id)) map.set(channel.id, game);
		}
		return map;
	});

	const searched = $derived(search.trim());
	/**
	 * Only the sports this profile picked (asked the first time Live TV opens; "+" changes them),
	 * so the page isn't every sport there is. A search still looks through all of them.
	 */
	const mine = $derived(guide?.sports?.length ? new Set<string>(guide.sports) : null);
	const isMine = (s: Sport) => !mine || mine.has(s) || Boolean(searched);
	let picking = $state(false);
	let choice = $state<Sport[]>([]);
	const asking = $derived(Boolean(guide && (guide.sports === null || picking)));
	$effect(() => {
		if (asking) choice = [...(guide?.sports ?? [])];
	});

	async function saveSports(list: Sport[]) {
		if (!guide) return;
		guide.sports = list;
		picking = false;
		if (sport !== 'all' && list.length && !list.includes(sport)) sport = 'all';
		await fetch('/api/live/sports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sports: list }) }).catch(() => {});
	}

	/** Other countries' games too (off: only those shown in Where to watch's country; a search finds all). */
	let allCountries = $state(allCountriesKept());
	const gamesFound = $derived(
		(guide?.games ?? []).filter((g) => isMine(g.sport) && (g.local !== false || allCountries || Boolean(searched)) && (!searched || matches(gameText(g), searched)))
	);
	const channelsFound = $derived((guide?.channels ?? []).filter((c) => !searched || matches(`${c.name} ${c.country}`, searched)));
	const savedFound = $derived({
		games: (guide?.savedGames ?? []).filter((g) => !searched || matches(gameText(g), searched)),
		channels: (guide?.savedChannels ?? [])
			.map((id) => channelById.get(id) ?? { id, name: `Channel ${id}`, sports: [], country: '' })
			.filter((c) => !searched || matches(c.name, searched)),
		recent: (guide?.recent ?? []).filter((c) => !searched || matches(c.name, searched))
	});

	const counts = $derived.by(() => {
		const list: Record<string, number> = {};
		if (tab === 'channels') for (const c of channelsFound) for (const s of c.sports) list[s] = (list[s] ?? 0) + 1;
		else for (const g of gamesFound) list[g.sport] = (list[g.sport] ?? 0) + 1;
		return list;
	});
	const sportsShown = $derived(SPORTS.filter((s) => (counts[s.key] && isMine(s.key)) || sport === s.key));

	const sportGames = $derived(sport === 'all' ? gamesFound : gamesFound.filter((g) => g.sport === sport));
	const leagues = $derived.by(() => {
		const tally = new Map<string, number>();
		for (const g of sportGames) tally.set(g.league, (tally.get(g.league) ?? 0) + 1);
		return [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	});
	const games = $derived(league ? sportGames.filter((g) => g.league === league) : sportGames);

	/** Each sport's games, those on now first, for the every-sport view. */
	const bySport = $derived(
		SPORTS.map((s) => {
			const list = gamesFound.filter((g) => g.sport === s.key);
			const on = list.filter((g) => isOnNow(g, now));
			const ordered = [...favoritesFirst(on), ...favoritesFirst(list.filter((g) => !isOnNow(g, now)))];
			return { ...s, on: on.length, total: list.length, first: ordered.slice(0, PER_SPORT) };
		}).filter((s) => s.total)
	);

	const sections = $derived.by(() => {
		const groups = new Map<string, LiveGame[]>();
		for (const g of games) {
			const group = timeGroup(g, now);
			if (!groups.has(group)) groups.set(group, []);
			groups.get(group)!.push(g);
		}
		return ['On now', 'Later today', 'Tomorrow', 'Later'].filter((n) => groups.has(n)).map((name) => ({ name, games: groups.get(name)! }));
	});

	const countries = $derived.by(() => {
		const all = new Set((guide?.channels ?? []).map((c) => c.country).filter(Boolean));
		return [...all].sort((a, b) => countryRank(a, guide?.homeCountry) - countryRank(b, guide?.homeCountry) || a.localeCompare(b));
	});

	/** Showing a game now (of the sport picked, if one is). */
	const onNowHere = (id: number) => {
		const game = showingNow.get(id);
		return !!game && (sport === 'all' || game.sport === sport);
	};
	const channels = $derived(
		channelsFound
			.filter((c) => (sport === 'all' || c.sports.includes(sport)) && (!country || searched || c.country === country))
			.sort(
				(a, b) =>
					Number(onNowHere(b.id)) - Number(onNowHere(a.id)) ||
					countryRank(a.country, guide?.homeCountry) - countryRank(b.country, guide?.homeCountry) ||
					Number(b.sports.length > 0) - Number(a.sports.length > 0) ||
					a.name.localeCompare(b.name)
			)
	);
	const channelsOnNow = $derived(channels.filter((c) => onNowHere(c.id)));
	const channelsRest = $derived(channels.filter((c) => !onNowHere(c.id)));

	const savedCount = $derived((guide?.savedGames.length ?? 0) + (guide?.savedChannels.length ?? 0));

	function pickSport(next: Sport | 'all') {
		sport = next;
		league = '';
		window.scrollTo({ top: 0 });
	}

	const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

	function saveGame(game: LiveGame) {
		if (!guide) return;
		const saved = !savedGameIds.has(game.id);
		guide.savedGames = saved ? [...guide.savedGames, game].sort((a, b) => a.start - b.start) : guide.savedGames.filter((g) => g.id !== game.id);
		sendSaved({ kind: 'game', game }, saved);
	}

	/**
	 * Right-click on a game or a channel: its channels to watch on, Save or Unsave, and for a game
	 * the rest of its sport. Kept inside the window.
	 */
	let menu = $state<{ x: number; y: number; game?: LiveGame; channel?: { id: number; name: string } } | null>(null);
	function openMenu(event: MouseEvent, what: { game?: LiveGame; channel?: { id: number; name: string } }) {
		event.preventDefault();
		const rows = what.game ? Math.min(what.game.channels.length, 6) + 3 : 3;
		menu = {
			x: Math.min(event.clientX, window.innerWidth - 240),
			y: Math.min(event.clientY, window.innerHeight - rows * 36 - 20),
			...what
		};
	}
	const closeMenu = () => (menu = null);
	function fromMenu(run: () => void) {
		run();
		menu = null;
	}

	function saveChannel(channel: { id: number; name: string }) {
		if (!guide) return;
		const saved = !savedChannelIds.has(channel.id);
		guide.savedChannels = saved ? [channel.id, ...guide.savedChannels] : guide.savedChannels.filter((id) => id !== channel.id);
		sendSaved({ kind: 'channel', id: channel.id, name: channel.name }, saved);
	}

	/** Off Recently watched: one channel, one replay, or all of them. */
	function forgetChannel(id: number) {
		if (!guide) return;
		guide.recent = guide.recent.filter((c) => c.id !== id);
		sendForget({ id });
	}
	function forgetReplay(replay: string) {
		if (!guide) return;
		guide.recentReplays = (guide.recentReplays ?? []).filter((r) => r.id !== replay);
		sendForget({ replay });
	}
	function forgetAll() {
		if (!guide) return;
		guide.recent = [];
		guide.recentReplays = [];
		sendForget('all');
	}
	const recentIds = $derived(new Set(guide?.recent.map((c) => c.id) ?? []));
</script>

{#snippet removeButton(label: string, onclick: () => void)}
	<button type="button" class="remove" aria-label="Remove {label} from Recently watched" title="Remove from Recently watched" {onclick}>
		<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
			<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
		</svg>
	</button>
{/snippet}

<svelte:head><title>Live TV · Catalog</title></svelte:head>

{#snippet gameRow(game: LiveGame, withSport = false)}
	{@const on = isOnNow(game, now)}
	{@const play = watchHref(bestChannel(game), game)}
	{@const all = opened.includes(game.id)}
	<li class="game" class:on oncontextmenu={(e) => openMenu(e, { game })}>
		<a class="thumb" href={play} tabindex="-1"><GameArt art={game.art} sport={game.sport} poster={game.poster} /></a>
		<a class="when" href={play}>
			{#if game.score && game.score.state !== 'pre'}
				<span class="score-line">
					<b class="score">{#if on}<span class="dot"></span>{/if}{scoreText(game.score)}</b>
					<span class="score-detail">{game.score.detail}</span>
				</span>
			{:else}
				{#if on}<span class="dot"></span>{/if}{whenText(game, now)}
			{/if}
		</a>
		<a class="what" href={play}>
			<span class="title">{game.title}</span>
			<span class="league">{[withSport && sportLabel(game.sport), game.league].filter(Boolean).join(' · ')}</span>
		</a>
		<div class="watch-on">
			{#each all ? channelsBestFirst(game) : channelsBestFirst(game).slice(0, 3) as channel (channel.id)}
				<a class="ch" href={watchHref(channel, game)}>{channel.name}</a>
			{/each}
			{#if game.channels.length > 3}
				<button type="button" class="ch more" onclick={() => (opened = toggle(opened, game.id))}>
					{all ? 'Fewer' : `+${game.channels.length - 3}`}
				</button>
			{/if}
		</div>
		<LiveStar saved={savedGameIds.has(game.id)} label={game.title} onclick={() => saveGame(game)} />
	</li>
{/snippet}

{#snippet channelCard(channel: LiveChannel | { id: number; name: string; country?: string }, recent = false)}
	{@const showing = showingNow.get(channel.id)}
	<li class="channel" class:recent oncontextmenu={(e) => openMenu(e, { channel })}>
		<a href={watchHref(channel, showing)}>
			<span class="name">{channel.name}</span>
			{#if showing}
				<span class="now"><span class="dot"></span>{showing.title}</span>
			{:else if channel.country}
				<span class="country">{channel.country}</span>
			{/if}
		</a>
		<LiveStar saved={savedChannelIds.has(channel.id)} label={channel.name} onclick={() => saveChannel(channel)} />
		{#if recent}{@render removeButton(channel.name, () => forgetChannel(channel.id))}{/if}
	</li>
{/snippet}

{#snippet more(key: string, total: number, shown: number)}
	{#if total > shown}
		<button type="button" class="show-all btn" onclick={() => (expanded = toggle(expanded, key))}>Show all {total}</button>
	{/if}
{/snippet}

{#if menu}
	<div class="ctx-backdrop" onclick={closeMenu} oncontextmenu={(e) => { e.preventDefault(); closeMenu(); }} role="presentation"></div>
	<div class="ctx-menu" style:left="{menu.x}px" style:top="{menu.y}px" role="menu">
		{#if menu.game}
			{@const game = menu.game}
			{#each channelsBestFirst(game).slice(0, 6) as channel (channel.id)}
				<button type="button" role="menuitem" onclick={() => fromMenu(() => goto(watchHref(channel, game)))}>▶ Watch on {channel.name}</button>
			{/each}
			<hr />
			<button type="button" role="menuitem" onclick={() => fromMenu(() => saveGame(game))}>{savedGameIds.has(game.id) ? 'Unsave' : 'Save for later'}</button>
			{#each game.art?.teams ?? [] as team (team.name)}
				<button type="button" role="menuitem" onclick={() => fromMenu(() => toggleTeam(team))}>{favorites.has(team.name) ? `★ ${team.name}: not a favorite` : `☆ Favorite ${team.name}`}</button>
			{/each}
			<button type="button" role="menuitem" onclick={() => fromMenu(() => { tab = 'games'; pickSport(game.sport); })}>More {sportLabel(game.sport).toLowerCase()}</button>
		{:else if menu.channel}
			{@const channel = menu.channel}
			{@const showing = showingNow.get(channel.id)}
			<button type="button" role="menuitem" onclick={() => fromMenu(() => goto(watchHref(channel, showing)))}>▶ Watch</button>
			<hr />
			<button type="button" role="menuitem" onclick={() => fromMenu(() => saveChannel(channel))}>{savedChannelIds.has(channel.id) ? 'Unsave' : 'Save'}</button>
			{#if recentIds.has(channel.id)}
				<button type="button" role="menuitem" onclick={() => fromMenu(() => forgetChannel(channel.id))}>Remove from Recently watched</button>
			{/if}
			{#if showing && !savedGameIds.has(showing.id)}
				<button type="button" role="menuitem" onclick={() => fromMenu(() => saveGame(showing))}>Save {showing.title}</button>
			{/if}
		{/if}
	</div>
{/if}

<div class="live">
	<header>
		<h1>Live TV</h1>
		<input type="search" placeholder="Search games, shows, teams, channels" aria-label="Search games, shows, teams and channels" bind:value={search} />
	</header>

	{#if guide && !guide.playable}
		<p class="note">Live TV plays through Catalog on the computer: open it there first.</p>
	{:else if guide && !guide.games.length && !guide.channels.length}
		<!-- Nothing ever fetched on this computer (a copy is kept once it has been): the site's out of reach. -->
		<p class="note">Live TV's listings can't be reached from this computer right now. Security software (Malwarebytes, a browser's shields) or the internet provider may be blocking the site.</p>
	{/if}

	<nav class="tabs" aria-label="Live TV">
		<button type="button" class:on={tab === 'games'} onclick={() => (tab = 'games')}>
			Schedule{#if guide}<span class="count">{gamesFound.length}</span>{/if}
		</button>
		<button type="button" class:on={tab === 'channels'} onclick={() => (tab = 'channels')}>
			Channels{#if guide}<span class="count">{channelsFound.length}</span>{/if}
		</button>
		<button type="button" class:on={tab === 'replays'} onclick={() => (tab = 'replays')}>
			Replays{#if replays}<span class="count">{replays.length}</span>{/if}
		</button>
		<button type="button" class:on={tab === 'saved'} onclick={() => (tab = 'saved')}>
			Saved{#if savedCount}<span class="count">{savedCount}</span>{/if}
		</button>
	</nav>

	{#if guide && asking}
		<section class="picker">
			<h2>Pick what Live TV shows</h2>
			<p class="pick-hint">Only those show here. Change them any time with +.</p>
			<div class="pick-list">
				{#each SPORTS as s (s.key)}
					<button type="button" class="pick" class:on={choice.includes(s.key)} aria-pressed={choice.includes(s.key)} onclick={() => (choice = toggle(choice, s.key) as Sport[])}>
						<span class="pick-art"><GameArt sport={s.key} /></span>
						<span class="pick-name">{s.label}</span>
					</button>
				{/each}
			</div>
			<div class="pick-actions">
				<button type="button" class="btn btn-primary" disabled={!choice.length} onclick={() => saveSports(choice)}>Done</button>
				<button type="button" class="btn" onclick={() => saveSports([])}>Every sport</button>
				{#if guide.sports !== null}<button type="button" class="btn" onclick={() => (picking = false)}>Cancel</button>{/if}
			</div>
		</section>
	{/if}

	{#if !guide}
		<p class="faint">{failed ? "Live TV can't be reached right now." : 'Loading the schedule…'}</p>
	{:else if tab === 'replays'}
		<div class="sports" role="group" aria-label="Sport">
			<button type="button" class="chip" class:on={sport === 'all'} onclick={() => pickSport('all')}>All</button>
			{#each SPORTS.filter((s) => isMine(s.key) && (replays ?? []).some((r) => r.sport === s.key)) as s (s.key)}
				<button type="button" class="chip" class:on={sport === s.key} onclick={() => pickSport(s.key)}>
					{s.label}<span class="count">{(replays ?? []).filter((r) => r.sport === s.key).length}</span>
				</button>
			{/each}
			<button type="button" class="chip add" title="Change which sports show" aria-label="Change which sports show" onclick={() => (picking = true)}>+</button>
		</div>
		{#if replays === null}
			<p class="faint">Loading replays…</p>
		{:else if !replaysFound.length}
			<p class="faint">{searched ? 'No replay called that.' : 'No replays right now.'}</p>
		{:else}
			<p class="faint replay-note">Whole games, a few hours to weeks old. One only hours old may not be ready yet.</p>
			<ul class="replays">
				{#each replaysFound as replay (replay.id)}
					<li>
						<a class="replay" href={replayHref(replay)} onpointerenter={() => warmReplay(replay.id)}>
							<span class="replay-art">{#if replay.poster}<img src={replay.poster} alt="" loading="lazy" />{/if}</span>
							<span class="replay-text">
								<span class="title">{replay.title}</span>
								<span class="league">{replayLine(replay)}</span>
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	{:else if tab === 'saved'}
		{#if savedFound.games.length}
			<section>
				<h2 class="label">Games</h2>
				<ul class="games">
					{#each savedFound.games as game (game.id)}{@render gameRow(game, true)}{/each}
				</ul>
			</section>
		{/if}
		{#if savedFound.channels.length}
			<section>
				<h2 class="label">Channels</h2>
				<ul class="channels">
					{#each savedFound.channels as channel (channel.id)}{@render channelCard(channel)}{/each}
				</ul>
			</section>
		{/if}
		{#if savedFound.recent.length}
			<section>
				<h2 class="label">Watched lately</h2>
				<ul class="channels">
					{#each savedFound.recent as channel (channel.id)}{@render channelCard(channelById.get(channel.id) ?? channel, true)}{/each}
				</ul>
			</section>
		{/if}
		{#if !savedFound.games.length && !savedFound.channels.length && !savedFound.recent.length}
			<p class="faint">{searched ? 'Nothing saved called that.' : 'Nothing saved yet. The star on a game or channel saves it here.'}</p>
		{/if}
	{:else}
		<div class="sports" role="group" aria-label="Sport">
			<button type="button" class="chip" class:on={sport === 'all'} onclick={() => pickSport('all')}>All</button>
			{#each sportsShown as s (s.key)}
				<button type="button" class="chip" class:on={sport === s.key} onclick={() => pickSport(s.key)}>
					{s.label}<span class="count">{counts[s.key] ?? 0}</span>
				</button>
			{/each}
			<button type="button" class="chip add" title="Change which sports show" aria-label="Change which sports show" onclick={() => (picking = true)}>+</button>
			{#if tab === 'games' && guide.homeCountry}
				<button type="button" class="chip" class:on={allCountries} aria-pressed={allCountries} onclick={() => keepAllCountries((allCountries = !allCountries))}>Other countries</button>
			{/if}
		</div>

		{#if tab === 'games'}
			{#if sport === 'all'}
				{#if !searched && (guide.recentReplays?.length || guide.recent.length)}
					<section>
						<div class="section-head">
							<h2>Recently watched</h2>
							<button type="button" class="see-all" onclick={forgetAll}>Clear</button>
						</div>
						{#if guide.recentReplays?.length}
							<ul class="replays recent">
								{#each guide.recentReplays as replay (replay.id)}
									<li class="recent">
										{@render removeButton(replay.title, () => forgetReplay(replay.id))}
										<a class="replay" href={replayHref(replay)}>
											<span class="replay-art">
												<GameArt sport={replay.sport} poster={replay.poster} />
												{#if replay.duration > 0 && replay.currentTime > 0}
													<span class="watched-bar"><span style:width="{Math.min(100, (replay.currentTime / replay.duration) * 100)}%"></span></span>
												{/if}
											</span>
											<span class="replay-text">
												<span class="title">{replay.title}</span>
												<span class="league">{replay.duration > 0 && replay.currentTime / replay.duration < 0.95 ? `${Math.max(1, Math.round((replay.duration - replay.currentTime) / 60))} min left` : 'Watched'} · Replay</span>
											</span>
										</a>
									</li>
								{/each}
							</ul>
						{/if}
						{#if guide.recent.length}
							<ul class="channels recent-channels">
								{#each guide.recent.slice(0, 6) as channel (channel.id)}{@render channelCard(channelById.get(channel.id) ?? channel, true)}{/each}
							</ul>
						{/if}
					</section>
				{/if}
				{#if yourTeams.length}
					<section>
						<div class="section-head"><h2>Your teams</h2></div>
						<ul class="games">
							{#each yourTeams.slice(0, PER_SECTION) as game (game.id)}{@render gameRow(game, true)}{/each}
						</ul>
					</section>
				{/if}
				{@const saved = guide.savedGames.filter((g) => !searched || matches(gameText(g), searched))}
				{#if saved.length}
					<section>
						<div class="section-head"><h2>Saved</h2></div>
						<ul class="games">
							{#each saved as game (game.id)}{@render gameRow(game, true)}{/each}
						</ul>
					</section>
				{/if}
				{#each bySport as s (s.key)}
					<section>
						<div class="section-head">
							<h2>{s.label}</h2>
							<span class="faint">{s.on ? `${s.on} on now · ` : ''}{s.total} {itemWord(s.key, s.total)}</span>
							{#if s.total > s.first.length}
								<button type="button" class="see-all" onclick={() => pickSport(s.key)}>See all</button>
							{/if}
						</div>
						<ul class="games">
							{#each s.first as game (game.id)}{@render gameRow(game)}{/each}
						</ul>
					</section>
				{:else}
					<p class="faint">{searched ? 'Nothing called that.' : 'Nothing on the schedule right now.'}</p>
				{/each}
			{:else}
				{#if leagues.length > 1}
					<select class="league-pick" bind:value={league} aria-label="League">
						<option value="">Every league</option>
						{#each leagues as [name, count] (name)}<option value={name}>{name} ({count})</option>{/each}
					</select>
				{/if}
				{#each sections as section (section.name)}
					{@const key = `${sport}:${league}:${section.name}`}
					{@const shown = expanded.includes(key) ? section.games : section.games.slice(0, PER_SECTION)}
					<section>
						<div class="section-head">
							<h2>{section.name}</h2>
							<span class="faint">{section.games.length}</span>
						</div>
						<ul class="games">
							{#each shown as game (game.id)}{@render gameRow(game)}{/each}
						</ul>
						{@render more(key, section.games.length, shown.length)}
					</section>
				{:else}
					<p class="faint">{searched ? 'Nothing called that.' : `No ${sportLabel(sport).toLowerCase()} on the schedule right now.`}</p>
				{/each}
			{/if}
		{:else}
			<div class="channel-filters">
				<select bind:value={country} onchange={() => (countryPicked = true)} aria-label="Country">
					<option value="">Every country</option>
					{#each countries as name (name)}<option value={name}>{name}</option>{/each}
				</select>
			</div>
			{#if channelsOnNow.length}
				<section>
					<div class="section-head"><h2>On now</h2><span class="faint">{channelsOnNow.length}</span></div>
					<ul class="channels">
						{#each channelsOnNow as channel (channel.id)}{@render channelCard(channel)}{/each}
					</ul>
				</section>
			{/if}
			{#if channelsRest.length}
				{@const key = `channels:${sport}:${country}`}
				{@const shown = expanded.includes(key) || searched ? channelsRest : channelsRest.slice(0, CHANNELS_SHOWN)}
				<section>
					<div class="section-head">
						<h2>{channelsOnNow.length ? 'Other channels' : 'Channels'}</h2>
						<span class="faint">{channelsRest.length}</span>
					</div>
					<ul class="channels">
						{#each shown as channel (channel.id)}{@render channelCard(channel)}{/each}
					</ul>
					{@render more(key, channelsRest.length, shown.length)}
				</section>
			{/if}
			{#if !channels.length}
				<p class="faint">{searched ? 'No channel called that.' : 'No channels for that.'}</p>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.live {
		display: flex;
		flex-direction: column;
		gap: 22px;
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
	}

	h1 {
		margin: 0;
	}

	header input {
		flex: 0 1 340px;
		min-width: 0;
	}

	.note {
		margin: 0;
		padding: 10px 14px;
		border-radius: var(--radius);
		background: var(--warn-bg);
		color: var(--warn);
	}

	.tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--rule);
	}

	.tabs button {
		display: flex;
		align-items: center;
		gap: 7px;
		margin-bottom: -1px;
		padding: 9px 14px;
		border: none;
		border-bottom: 2px solid transparent;
		background: none;
		color: var(--ink-soft);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.tabs button:hover {
		color: var(--ink);
	}

	.tabs button.on {
		border-bottom-color: var(--accent);
		color: var(--ink);
	}

	.count {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--ink-faint);
	}

	.sports {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.picker {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 18px;
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.picker h2 {
		font-size: 1.15rem;
	}

	.pick-hint {
		margin: -8px 0 0;
		font-size: 0.88rem;
		color: var(--ink-soft);
	}

	.pick-list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
		gap: 10px;
	}

	.pick {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 0 0 8px;
		border: 2px solid transparent;
		border-radius: 10px;
		background: var(--paper);
		color: var(--ink-soft);
		font: inherit;
		cursor: pointer;
		overflow: hidden;
		opacity: 0.6;
	}

	.pick.on {
		border-color: var(--ink);
		color: var(--ink);
		opacity: 1;
	}

	.pick-art {
		display: block;
	}

	.pick-name {
		font-weight: 600;
	}

	.pick-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.chip.add {
		font-size: 1rem;
		padding: 4px 13px;
	}

	.chip {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border: 1px solid var(--rule-firm);
		border-radius: 999px;
		background: var(--surface);
		color: var(--ink-soft);
		font: inherit;
		font-size: 0.88rem;
		cursor: pointer;
	}

	.chip:hover {
		border-color: var(--ink-faint);
		color: var(--ink);
	}

	.chip.on {
		border-color: var(--ink);
		background: var(--ink);
		color: var(--paper);
	}

	.chip.on .count {
		color: inherit;
		opacity: 0.7;
	}

	section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.section-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}

	.section-head h2 {
		margin: 0;
		font-size: 1.15rem;
	}

	.see-all {
		margin-left: auto;
		padding: 0;
		border: none;
		background: none;
		color: var(--accent);
		font: inherit;
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
	}

	.label {
		margin: 0;
		font-family: var(--body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.games,
	.channels {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.games {
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.game {
		display: grid;
		grid-template-columns: 112px 110px minmax(240px, 1fr) minmax(0, auto) auto;
		align-items: center;
		gap: 14px;
		padding: 8px 8px 8px 14px;
	}

	.score-line {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.score {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 1.05rem;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}

	.score-detail {
		font-size: 0.78rem;
		color: var(--ink-faint);
	}

	.thumb {
		display: block;
		border-radius: 6px;
		overflow: hidden;
	}

	.game + .game {
		border-top: 1px solid var(--rule);
	}

	.game a {
		color: inherit;
		text-decoration: none;
	}

	.when {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 0.88rem;
		color: var(--ink-soft);
		white-space: nowrap;
	}

	.game.on .when {
		color: var(--accent);
		font-weight: 600;
	}

	.dot {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent);
	}

	.what {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.what:hover .title {
		color: var(--accent);
	}

	.title {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.league {
		font-size: 0.8rem;
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.watch-on {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 4px;
		max-width: 420px;
	}

	.ch {
		padding: 3px 9px;
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-soft);
		font: inherit;
		font-size: 0.78rem;
		white-space: nowrap;
		cursor: pointer;
	}

	.ch:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.ch.more {
		border-style: dashed;
	}

	.league-pick,
	.channel-filters select {
		align-self: flex-start;
		width: auto;
		min-width: 200px;
		max-width: 100%;
	}

	.channels {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 8px;
	}

	.channel {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 4px 4px 12px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.channel:hover {
		border-color: var(--rule-firm);
	}

	.channel a {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		padding: 5px 0;
		color: var(--ink);
		text-decoration: none;
	}

	.channel a:hover .name {
		color: var(--accent);
	}

	.name,
	.now,
	.country {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.name {
		font-size: 0.92rem;
		font-weight: 600;
	}

	.now {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.78rem;
		color: var(--accent);
	}

	.country {
		font-size: 0.78rem;
		color: var(--ink-faint);
	}

	.show-all {
		align-self: flex-start;
	}

	@media (max-width: 700px) {
		.game {
			grid-template-columns: 88px minmax(0, 1fr) auto;
			gap: 4px 10px;
		}

		.thumb {
			grid-row: 1 / span 3;
		}

		.when {
			grid-column: 2 / -1;
		}

		.watch-on {
			grid-column: 2;
			justify-content: flex-start;
		}

		.game :global(.star) {
			grid-row: 2;
			grid-column: 3;
		}
	}

	/* The right-click menu, as on Browse. */
	.ctx-backdrop {
		position: fixed;
		inset: 0;
		z-index: 900;
	}

	.ctx-menu {
		position: fixed;
		z-index: 901;
		min-width: 200px;
		max-width: 320px;
		padding: 4px 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		background: var(--surface);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}

	.ctx-menu button {
		display: block;
		width: 100%;
		padding: 8px 14px;
		border: none;
		background: none;
		color: var(--ink);
		font-size: 0.84rem;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
	}

	.ctx-menu button:hover {
		background: var(--accent);
		color: var(--accent-ink);
	}

	.ctx-menu hr {
		margin: 4px 0;
		border: none;
		border-top: 1px solid var(--rule);
	}

	/* Replays: a picture of each game and its name, in a grid. */
	.replay-note {
		margin: 0;
	}

	.replays {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 14px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.replay {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--ink);
		text-decoration: none;
	}

	.replay:hover {
		border-color: var(--accent);
	}

	.replay-art {
		position: relative;
		aspect-ratio: 16 / 9;
		background: var(--surface-2);
	}

	/* How far a replay got, along the bottom of its picture (as on Continue Watching). */
	.watched-bar {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 4px;
		background: rgb(0 0 0 / 0.5);
	}

	.watched-bar span {
		display: block;
		height: 100%;
		background: var(--accent);
	}

	.replays.recent {
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
	}

	.recent-channels {
		margin-top: 12px;
	}

	/* The x that takes a channel or replay off Recently watched: shows on hover (always on touch screens). */
	.remove {
		display: grid;
		place-items: center;
		flex: none;
		width: 30px;
		height: 30px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
		opacity: 0;
	}

	.remove:hover {
		background: var(--surface-2);
		color: var(--ink);
	}

	.recent:hover .remove,
	.remove:focus-visible {
		opacity: 1;
	}

	@media (hover: none) {
		.remove {
			opacity: 1;
		}
	}

	/* On a replay it sits over the top right corner of the picture. */
	.replays .recent {
		position: relative;
	}

	.replays .recent .remove {
		position: absolute;
		top: 6px;
		right: 6px;
		z-index: 1;
		background: rgb(0 0 0 / 0.6);
		color: #fff;
	}

	.replays .recent .remove:hover {
		background: rgb(0 0 0 / 0.85);
	}

	.replay-art img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.replay-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 10px 12px;
		min-width: 0;
	}
</style>
