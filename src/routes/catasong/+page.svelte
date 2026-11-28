<script lang="ts">
	/*
	 * Catasong: a song a day for each genre. Heard for 0.1 s, then 0.5, 2, 8 and 16 s after each
	 * miss or skip. Red: wrong. Yellow: right artist, wrong song. The day's song, the guesses and
	 * the streaks are all on the server (src/lib/server/catasong/daily.ts); this page plays the
	 * sound it's given (lib/catasong/player.svelte.ts) and sends guesses.
	 *
	 * Looks: the genre's album covers drift behind the page, in the genre's two colors
	 * (--cs-hot, --cs-deep). Phonk turns on bloodlust: everything goes red and the edges of the
	 * screen pulse with the music.
	 */
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import BackBar from '$lib/BackBar.svelte';
	import CoverWall from '$lib/catasong/CoverWall.svelte';
	import PlayButton from '$lib/catasong/PlayButton.svelte';
	import PinToSidebar from '$lib/catasong/PinToSidebar.svelte';
	import Smoke from '$lib/catasong/Smoke.svelte';
	import SongLinks from '$lib/catasong/SongLinks.svelte';
	import Visualizer from '$lib/catasong/Visualizer.svelte';
	import VolumeSlider from '$lib/catasong/VolumeSlider.svelte';
	import { SongPlayer } from '$lib/catasong/player.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Try = { text: string; verdict: 'wrong' | 'artist' | 'skip' };
	type Song = { id: number; title: string; artist: string; artistId: number; cover: string | null; album: string | null };
	type Stats = { played: number; won: number; streak: number; best: number; last: string | null };
	type Today = { genre: string; label: string; play: { tries: Try[]; done: boolean; won: boolean }; stats: Stats; answer: Song | null; msToNext: number };
	type Found = { id: number; title: string; artist: string; artistId: number };
	type Endless = { token: string; play: { tries: Try[]; done: boolean; won: boolean }; answer: Song | null; streak: number; best: number };

	const steps = untrack(() => data.steps);
	const LONGEST = steps[steps.length - 1];

	const player = new SongPlayer();
	player.volume = untrack(() => data.volume);

	let today = $state<Today | null>(null);
	/** Endless: the round being played, and the next one (asked for and its song fetched meanwhile). */
	let endless = $state<Endless | null>(null);
	let queued: { genre: string; round: Endless } | null = null;
	let empty = $state(false);
	let loading = $state(true);
	let covers = $state<string[]>([]);
	let showGenres = $state(false);
	let typedGenre = $state('');
	let genreMissing = $state(false);
	let shake = $state(0);

	const endlessMode = $derived(data.mode === 'endless');
	const game = $derived(endlessMode ? endless : today);
	const tries = $derived(game?.play.tries ?? []);
	const done = $derived(game?.play.done ?? false);
	const step = $derived(Math.min(tries.length, steps.length - 1));
	const isMain = $derived(data.main.includes(data.genre));
	const bloodlust = $derived(data.genre === 'phonk');

	/* ------------------------------------------------------------ colors per genre */

	const COLORS: Record<string, [string, string]> = {
		rap: ['#f5b83d', '#8a4bff'],
		rock: ['#ff5a3c', '#7a1fa2'],
		all: ['#e994c2', '#3fb8e6'],
		phonk: ['#ff1f3d', '#6b0012'],
		metal: ['#c9ced6', '#5b1a1a'],
		pop: ['#ff7ad9', '#7b6bff'],
		country: ['#e8a85a', '#4f7a3a'],
		jazz: ['#f2c879', '#1f4e79'],
		kpop: ['#ff8fc7', '#52e0ff'],
		lofi: ['#c8a2ff', '#3c5a7a'],
		edm: ['#3dffd0', '#7a3dff'],
		latin: ['#ffb03d', '#e0335a'],
		reggaeton: ['#ffd23d', '#e0335a'],
		classical: ['#e9dcc2', '#5a4a3a']
	};
	const SPARES: [string, string][] = [
		['#4ce0a0', '#3a5bd9'],
		['#ffa24c', '#c2186b'],
		['#7ad0ff', '#6a3dd9'],
		['#f06d6d', '#3a3dd9'],
		['#d9f05a', '#2a8a6a']
	];
	const colors = $derived.by(() => {
		if (COLORS[data.genre]) return COLORS[data.genre];
		let n = 0;
		for (const letter of data.genre) n = (n * 31 + letter.charCodeAt(0)) >>> 0;
		return SPARES[n % SPARES.length];
	});

	/* ------------------------------------------------------------ the day */

	/** The song now being guessed: today's for the genre, or the Endless round's. */
	const audioUrl = () =>
		endlessMode && endless ? `/api/catasong/audio?token=${endless.token}` : `/api/catasong/audio?genre=${encodeURIComponent(data.genre)}`;

	async function askEndless(genre: string): Promise<Endless | null> {
		const response = await fetch(`/api/catasong?do=endless&genre=${encodeURIComponent(genre)}`).catch(() => null);
		const answer = response?.ok ? await response.json() : null;
		return answer && !('empty' in answer) ? answer : null;
	}

	/** Asks for the next Endless song while this one is played, and fetches its sound. */
	async function queueEndless(genre: string) {
		const round = await askEndless(genre);
		if (!round || genre !== data.genre || !endlessMode) return;
		queued = { genre, round };
		player.prefetch(`/api/catasong/audio?token=${round.token}`);
	}

	async function loadGame(genre: string, mode: string) {
		loading = true;
		empty = false;
		showGenres = false;
		player.clear();
		const asking =
			mode === 'endless'
				? queued?.genre === genre
					? Promise.resolve(queued.round)
					: askEndless(genre)
				: fetch(`/api/catasong?do=today&genre=${encodeURIComponent(genre)}`)
						.then((r) => (r.ok ? r.json() : null))
						.catch(() => null);
		queued = null;
		const [answer, coverAnswer] = await Promise.all([
			asking,
			fetch(`/api/catasong?do=covers&genre=${encodeURIComponent(genre)}`).catch(() => null)
		]);
		if (genre !== data.genre || mode !== data.mode) return;
		if (coverAnswer?.ok) covers = await coverAnswer.json();
		loading = false;
		if (!answer || 'empty' in answer) {
			if (mode === 'endless') endless = null;
			else today = null;
			empty = true;
			return;
		}
		if (mode === 'endless') {
			endless = answer;
			void queueEndless(genre);
		} else {
			today = answer;
			resetAt = Date.now() + answer.msToNext;
		}
		// The song comes now, before Play is pressed, so Play starts at once.
		return player.load(audioUrl());
	}

	$effect(() => {
		const genre = data.genre;
		const mode = data.mode;
		untrack(() => void loadGame(genre, mode));
	});

	async function pressPlay(seconds: number) {
		if (player.playing) {
			player.stop();
			return;
		}
		if (!player.ready) await player.load(audioUrl());
		player.play(seconds);
	}

	/** Endless: on to the next song (already fetched, so it plays at once). */
	async function nextSong() {
		const loaded = await loadGame(data.genre, data.mode);
		if (loaded && endless) player.play(steps[0]);
	}

	const hrefFor = (genre: string, mode: string) =>
		`?g=${encodeURIComponent(genre)}${mode === 'endless' ? '&m=endless' : ''}`;

	function pickGenre(key: string) {
		showGenres = false;
		if (key === data.genre) return;
		void goto(hrefFor(key, data.mode), { replaceState: true, noScroll: true, keepFocus: true });
	}

	function pickMode(mode: string) {
		if (mode === data.mode) return;
		void goto(hrefFor(data.genre, mode), { replaceState: true, noScroll: true, keepFocus: true });
	}

	async function pickTyped(event: SubmitEvent) {
		event.preventDefault();
		genreMissing = false;
		const response = await fetch(`/api/catasong?do=genre&q=${encodeURIComponent(typedGenre)}`).catch(() => null);
		const answer = response?.ok ? ((await response.json()) as { key: string | null }) : { key: null };
		if (!answer.key) {
			genreMissing = true;
			return;
		}
		typedGenre = '';
		pickGenre(answer.key);
	}

	async function send(guess: Found | null) {
		if (!game || done) return;
		const response = await fetch('/api/catasong', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(endlessMode && endless ? { token: endless.token, guess } : { genre: data.genre, guess })
		}).catch(() => null);
		if (!response?.ok) return;
		const answer = await response.json();
		if ('empty' in answer) return;
		const before = tries.length;
		if (endlessMode) endless = answer;
		else today = answer;
		typed = '';
		found = [];
		if (answer.play.tries.length > before && answer.play.tries.at(-1)?.verdict !== 'skip') shake++;
		if (!player.ready) await player.load(audioUrl());
		player.play(answer.play.done ? 30 : steps[Math.min(answer.play.tries.length, steps.length - 1)]);
	}

	/* ------------------------------------------------------------ the guess box */

	let typed = $state('');
	let found = $state<Found[]>([]);
	let highlighted = $state(0);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	function onType() {
		highlighted = 0;
		clearTimeout(searchTimer);
		const query = typed;
		if (query.trim().length < 2) {
			found = [];
			return;
		}
		searchTimer = setTimeout(async () => {
			const response = await fetch(`/api/catasong?do=search&q=${encodeURIComponent(query)}`).catch(() => null);
			if (response?.ok && typed === query) found = await response.json();
		}, 250);
	}

	function onGuessKey(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			highlighted = Math.min(highlighted + 1, found.length - 1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			highlighted = Math.max(highlighted - 1, 0);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (found[highlighted]) void send(found[highlighted]);
		} else if (event.key === 'Escape') {
			found = [];
		}
	}

	/* ------------------------------------------------------------ what moves with the music */

	let elapsed = $state(0);
	let level = $state(0);
	$effect(() => {
		if (!player.playing) {
			elapsed = 0;
			level = 0;
			return;
		}
		// The loop runs outside the effect (untracked): it writes elapsed and level, which an
		// effect mustn't also read, or Svelte stops updating the page.
		let frame = 0;
		let smooth = 0;
		const tick = () => {
			elapsed = player.elapsed();
			smooth += (player.level() - smooth) * 0.35;
			level = smooth;
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	});

	/** When the daily songs change (midnight Eastern, from the server), and the clock it's counted on. */
	let resetAt = $state(0);
	let clockNow = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => {
			clockNow = Date.now();
			// Past midnight Eastern: today's new song is asked for (only on the daily game).
			if (resetAt && clockNow >= resetAt && !endlessMode) {
				resetAt = 0;
				void loadGame(data.genre, 'daily');
			}
		}, 1000);
		return () => clearInterval(timer);
	});
	const nextIn = $derived(Math.max(0, resetAt - clockNow));
	const two = (n: number) => String(n).padStart(2, '0');
	const nextText = $derived(`${Math.floor(nextIn / 3_600_000)}h ${two(Math.floor((nextIn % 3_600_000) / 60_000))}m ${two(Math.floor((nextIn % 60_000) / 1000))}s`);

	$effect(() => () => {
		clearTimeout(searchTimer);
		player.close();
	});

	function onPageKey(event: KeyboardEvent) {
		if (event.key === 'Enter' && endlessMode && done && document.activeElement?.tagName !== 'INPUT') {
			event.preventDefault();
			void nextSong();
		}
	}

	const mark = (seconds: number) => `${Math.min(100, (seconds / LONGEST) * 100)}%`;
	const verdictWord = { wrong: 'Wrong', artist: 'Right artist', skip: 'Skipped' } as const;
</script>

<svelte:head>
	<title>{bloodlust ? 'Phonkdle' : 'Catasong'}</title>
</svelte:head>

<svelte:window onkeydown={onPageKey} />

<div class="page" class:bloodlust style="--cs-hot: {colors[0]}; --cs-deep: {colors[1]}; --level: {level}">
	<CoverWall {covers} />
	{#if bloodlust}
		<Smoke {player} />
		{#key data.genre}<div class="flash" aria-hidden="true"></div>{/key}
		<div class="vignette" aria-hidden="true"></div>
	{/if}

	<div class="content">
		<BackBar />
		<PinToSidebar />

		<header class="top">
			<div>
				<h1 class="title">
					<span class="title-text">{bloodlust ? 'Phonkdle' : 'Catasong'}</span>
					{#if bloodlust}<span class="mode">Bloodlust</span>{/if}
				</h1>
				<p class="lede">A new song every day in each genre.</p>
				{#if resetAt && !endlessMode}<p class="reset tabular">New songs in {nextText} <span>· midnight ET</span></p>{/if}
			</div>
			<a class="other-game" href="/catasong/anime">
				<span class="other-kicker">Also</span>
				<span class="other-name">Guess the Anime</span>
				<span class="other-line">15 s of an opening or ending</span>
			</a>
		</header>

		<div class="genres">
			{#each data.main as key (key)}
				<button type="button" class="chip" class:active={data.genre === key} onclick={() => pickGenre(key)}>
					{data.genres.find((g) => g.key === key)?.label}
				</button>
			{/each}
			{#if !isMain}
				<button type="button" class="chip active">{data.label}</button>
			{/if}
			<button type="button" class="chip more" class:open={showGenres} onclick={() => (showGenres = !showGenres)} aria-expanded={showGenres}>
				More genres
			</button>
		</div>

		{#if showGenres}
			<div class="genre-panel">
				<div class="genre-grid">
					{#each data.genres.filter((g) => !data.main.includes(g.key)) as genre (genre.key)}
						<button type="button" class="chip small" class:active={data.genre === genre.key} class:phonk={genre.key === 'phonk'} onclick={() => pickGenre(genre.key)}>
							{genre.label}
						</button>
					{/each}
				</div>
				<form class="any-genre" onsubmit={pickTyped}>
					<input bind:value={typedGenre} placeholder="Any genre" aria-label="Any genre" maxlength="30" />
					<button type="submit" disabled={typedGenre.trim().length < 2}>Play</button>
				</form>
				{#if genreMissing}<p class="hint">That can't be a genre here. Letters and numbers only.</p>{/if}
			</div>
		{/if}

		<section class="stage" class:waiting={loading} class:shake={shake > 0 && bloodlust} data-shake={shake}>
			<div class="stage-top">
				<div class="modes" role="group" aria-label="Mode">
					<button type="button" class:active={!endlessMode} onclick={() => pickMode('daily')}>Daily</button>
					<button type="button" class:active={endlessMode} onclick={() => pickMode('endless')}>Endless</button>
				</div>
				<span class="day">
					{endlessMode ? data.label : `Today · ${data.label}`}
					{#if endlessMode && endless}<span class="streak tabular">Streak {endless.streak} · Best {endless.best}</span>{/if}
				</span>
				<VolumeSlider {player} />
			</div>

			{#if empty && !loading}
				<p class="note">No {data.label.toLowerCase()} songs could be found right now.</p>
			{:else}
				<ol class="tries">
					{#each steps as seconds, i (i)}
						{@const tried = loading ? undefined : tries[i]}
						<li class={tried?.verdict ?? (!loading && i === tries.length && !done ? 'next' : '')} style="--i: {i}">
							<span class="slot tabular">{seconds}s</span>
							{#if tried}
								<span class="text">{tried.text}</span>
								<span class="tag">{verdictWord[tried.verdict]}</span>
							{:else if !loading && i === tries.length && !done}
								<span class="text faint">Your guess</span>
							{/if}
						</li>
					{/each}
				</ol>

				<div class="bar" aria-hidden="true">
					<span class="open" style="width: {done ? '100%' : mark(steps[step])}"></span>
					{#each steps.slice(0, -1) as seconds (seconds)}
						<span class="tick" style="left: {mark(seconds)}"></span>
					{/each}
					{#if player.playing}<span class="fill" style="width: {mark(elapsed)}"></span>{/if}
				</div>

				<div class="player-row">
					<PlayButton
						{player}
						label={loading ? '…' : done ? (player.playing ? 'Stop' : 'Hear it') : player.playing ? 'Stop' : `${steps[step]}s`}
						sub={loading ? 'Picking the song' : player.loading ? 'Loading the song' : player.failed ? "Didn't load. Press to try again." : player.playing ? 'Press to stop' : done ? '30 s preview' : 'Press to hear'}
						disabled={loading || !game}
						onclick={() => pressPlay(done ? 30 : steps[step])}
					/>
					<div class="viz"><Visualizer {player} /></div>
				</div>

				{#if !done && !loading && game}
					<div class="guess-row">
						<div class="guess">
							<input
								bind:value={typed}
								oninput={onType}
								onkeydown={onGuessKey}
								type="text"
								placeholder="Search for the song or artist"
								aria-label="Your guess"
								autocomplete="off"
								spellcheck="false"
							/>
							{#if found.length}
								<ul class="suggestions" role="listbox">
									{#each found as song, i (song.id)}
										<li role="option" aria-selected={i === highlighted}>
											<button type="button" class:highlighted={i === highlighted} onmouseenter={() => (highlighted = i)} onclick={() => send(song)}>
												<span>{song.title}</span>
												<span class="by">{song.artist}</span>
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
						<button type="button" class="skip" onclick={() => send(null)}>
							{step + 1 < steps.length ? `Skip +${+(steps[step + 1] - steps[step]).toFixed(1)}s` : 'Give up'}
						</button>
					</div>
				{:else if done && game?.answer}
					<div class="answer" class:won={game.play.won} style={game.answer.cover ? `--art: url(${game.answer.cover})` : ''}>
						<div class="answer-glow" aria-hidden="true"></div>
						{#if game.answer.cover}<img src={game.answer.cover} alt="" width="120" height="120" />{/if}
						<div class="answer-words">
							<p class="verdict">{game.play.won ? `Got it in ${steps[step]}s` : endlessMode ? 'The song' : "Today's song"}</p>
							<h2>{game.answer.title}</h2>
							<p class="artist">{game.answer.artist}</p>
							{#if game.answer.album}<p class="album">{game.answer.album}</p>{/if}
							<div class="answer-links"><SongLinks song={game.answer.title} artist={game.answer.artist} /></div>
						</div>
					</div>
				{/if}
				{#if done && endlessMode && endless?.answer}
					<button type="button" class="next-song" onclick={nextSong}>Next song</button>
				{:else if done && today?.answer}
					<div class="stats tabular">
						<div><strong>{today.stats.played}</strong><span>Played</span></div>
						<div><strong>{today.stats.played ? Math.round((today.stats.won / today.stats.played) * 100) : 0}%</strong><span>Won</span></div>
						<div><strong>{today.stats.streak}</strong><span>Streak</span></div>
						<div><strong>{today.stats.best}</strong><span>Best</span></div>
					</div>
					<p class="next">Next {today.label.toLowerCase()} song in {nextText}</p>
				{/if}
			{/if}
		</section>

		<p class="credit">Songs from Deezer.</p>
	</div>
</div>

<style>
	.page {
		position: relative;
		min-height: 100%;
		isolation: isolate;
	}
	.content {
		position: relative;
		z-index: 1;
		max-width: 760px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 18px;
		padding-bottom: 40px;
	}

	/* ---------------------------------------------------------- header */
	.top {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		justify-content: space-between;
		align-items: flex-end;
	}
	.title {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.title-text {
		font-family: var(--display);
		font-size: clamp(2.6rem, 7vw, 4rem);
		line-height: 1.12;
		/* Room for g, y and p: text cut out of a gradient is clipped at its line box. */
		padding-bottom: 0.12em;
		letter-spacing: -0.02em;
		background: linear-gradient(100deg, var(--cs-hot), #fff 45%, var(--cs-hot) 60%, var(--cs-deep));
		background-size: 250% 100%;
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
		animation: shimmer 7s ease-in-out infinite;
	}
	@keyframes shimmer {
		0%,
		100% {
			background-position: 100% 0;
		}
		50% {
			background-position: 0 0;
		}
	}
	.reset {
		margin: 4px 0 0;
		font-size: 0.85rem;
		color: var(--ink-soft);
	}
	.reset span {
		color: var(--ink-faint);
	}
	.lede {
		margin: 8px 0 0;
		color: var(--ink-soft);
	}
	.other-game {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 18px;
		border-radius: 14px;
		color: var(--ink);
		text-decoration: none;
		background:
			linear-gradient(var(--surface), var(--surface)) padding-box,
			linear-gradient(135deg, #8a6bff, #ff7ad9, #3fb8e6) border-box;
		border: 1.5px solid transparent;
		box-shadow: 0 10px 30px -18px #8a6bff;
		transition:
			transform 0.15s ease,
			box-shadow 0.2s ease;
	}
	.other-game:hover {
		transform: translateY(-2px);
		box-shadow: 0 16px 36px -14px #8a6bff;
	}
	.other-kicker {
		font-size: 0.68rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}
	.other-name {
		font-family: var(--display);
		font-size: 1.2rem;
	}
	.other-line {
		font-size: 0.8rem;
		color: var(--ink-faint);
	}

	/* ---------------------------------------------------------- genre chips */
	.genres,
	.genre-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.chip {
		position: relative;
		padding: 8px 18px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--ink) 14%, transparent);
		background: color-mix(in srgb, var(--surface) 70%, transparent);
		backdrop-filter: blur(8px);
		color: var(--ink-soft);
		font-weight: 600;
		cursor: pointer;
		transition:
			transform 0.12s ease,
			background 0.2s ease,
			color 0.2s ease,
			box-shadow 0.2s ease;
	}
	.chip:hover {
		transform: translateY(-1px);
		color: var(--ink);
		border-color: color-mix(in srgb, var(--cs-hot) 60%, transparent);
	}
	.chip:active {
		transform: scale(0.96);
	}
	.chip.active {
		color: #fff;
		border-color: transparent;
		background: linear-gradient(135deg, var(--cs-hot), var(--cs-deep));
		box-shadow: 0 8px 24px -10px var(--cs-hot);
		text-shadow: 0 1px 2px rgb(0 0 0 / 35%);
	}
	.chip.more {
		border-style: dashed;
	}
	.chip.more.open {
		border-style: solid;
		color: var(--ink);
	}
	.chip.small {
		padding: 5px 13px;
		font-size: 0.88rem;
		font-weight: 500;
	}
	.chip.phonk:not(.active) {
		color: #ff4d64;
		border-color: color-mix(in srgb, #ff1f3d 45%, transparent);
	}
	.genre-panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		border-radius: 16px;
		background: color-mix(in srgb, var(--surface) 80%, transparent);
		backdrop-filter: blur(14px);
		border: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
		animation: drop 0.18s ease-out;
	}
	@keyframes drop {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
	}
	.hint {
		margin: 0;
		font-size: 0.85rem;
		color: var(--ink-faint);
	}
	.any-genre {
		display: flex;
		gap: 8px;
	}
	.any-genre input {
		flex: 1;
		min-width: 0;
		padding: 9px 14px;
		border-radius: 999px;
		border: 1px solid var(--rule-firm);
		background: var(--paper);
		color: var(--ink);
	}
	.any-genre button {
		padding: 9px 18px;
		border-radius: 999px;
		border: none;
		background: linear-gradient(135deg, var(--cs-hot), var(--cs-deep));
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}
	.any-genre button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	/* ---------------------------------------------------------- the game */
	.stage {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 22px;
		border-radius: 20px;
		background: color-mix(in srgb, var(--surface) 78%, transparent);
		backdrop-filter: blur(18px) saturate(1.2);
		border: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
		box-shadow:
			0 30px 80px -40px color-mix(in srgb, var(--cs-deep) 80%, transparent),
			inset 0 1px 0 rgb(255 255 255 / 6%);
		transition: opacity 0.2s ease;
	}
	.stage.waiting .tries,
	.stage.waiting .bar {
		opacity: 0.45;
	}
	.stage-top {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
	}
	.modes {
		display: inline-flex;
		padding: 3px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--ink) 7%, transparent);
	}
	.modes button {
		padding: 5px 14px;
		border: none;
		border-radius: 999px;
		background: none;
		color: var(--ink-soft);
		font-weight: 700;
		font-size: 0.82rem;
		cursor: pointer;
		transition:
			background 0.2s ease,
			color 0.2s ease;
	}
	.modes button.active {
		color: #fff;
		background: linear-gradient(135deg, var(--cs-hot), var(--cs-deep));
		text-shadow: 0 1px 2px rgb(0 0 0 / 30%);
	}
	.streak {
		margin-left: 8px;
		color: var(--ink-soft);
		letter-spacing: 0.06em;
	}
	.next-song {
		align-self: center;
		padding: 13px 40px;
		border: none;
		border-radius: 999px;
		color: #fff;
		font-weight: 700;
		font-size: 1.05rem;
		background: linear-gradient(135deg, var(--cs-hot), var(--cs-deep));
		box-shadow: 0 14px 34px -14px var(--cs-hot);
		cursor: pointer;
		transition: transform 0.12s ease;
		animation: reveal 0.4s ease-out;
	}
	.next-song:hover {
		transform: translateY(-2px) scale(1.03);
	}
	.day {
		font-size: 0.75rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--cs-hot);
		font-weight: 700;
	}
	.note {
		margin: 0;
		color: var(--ink-soft);
	}
	.tries {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 7px;
	}
	.tries li {
		min-height: 42px;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 6px 12px 6px 6px;
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--ink) 9%, transparent);
		background: color-mix(in srgb, var(--sunk) 75%, transparent);
		font-size: 0.93rem;
		transition:
			background 0.25s ease,
			border-color 0.25s ease;
	}
	.slot {
		flex: none;
		min-width: 46px;
		padding: 5px 0;
		text-align: center;
		border-radius: 8px;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--ink-faint);
		background: color-mix(in srgb, var(--ink) 6%, transparent);
	}
	.text {
		flex: 1;
		min-width: 0;
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag {
		flex: none;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		padding: 3px 8px;
		border-radius: 999px;
	}
	.tries li.next {
		border-color: color-mix(in srgb, var(--cs-hot) 55%, transparent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--cs-hot) 14%, transparent);
	}
	.tries li.next .slot {
		color: #fff;
		background: linear-gradient(135deg, var(--cs-hot), var(--cs-deep));
	}
	.tries li.wrong,
	.tries li.artist,
	.tries li.skip {
		animation: land 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.3);
	}
	@keyframes land {
		from {
			transform: translateX(-10px) scale(0.98);
			opacity: 0;
		}
	}
	.tries li.wrong {
		border-color: color-mix(in srgb, #e5484d 50%, transparent);
		background: color-mix(in srgb, #e5484d 13%, var(--sunk));
	}
	.tries li.wrong .tag {
		background: #e5484d;
		color: #fff;
	}
	.tries li.wrong .slot {
		color: #fff;
		background: #e5484d;
	}
	.tries li.artist {
		border-color: #f2b51e;
		background: color-mix(in srgb, #f2b51e 24%, var(--sunk));
	}
	.tries li.artist .tag,
	.tries li.artist .slot {
		background: #f2b51e;
		color: #241a00;
	}
	.tries li.skip .tag {
		background: color-mix(in srgb, var(--ink) 14%, transparent);
		color: var(--ink-soft);
	}
	.tries li.skip .text {
		color: var(--ink-faint);
	}

	.bar {
		position: relative;
		height: 10px;
		border-radius: 5px;
		background: color-mix(in srgb, var(--ink) 8%, transparent);
		overflow: hidden;
	}
	.bar .open {
		position: absolute;
		inset: 0 auto 0 0;
		background: color-mix(in srgb, var(--cs-hot) 22%, transparent);
		transition: width 0.4s cubic-bezier(0.2, 0.9, 0.3, 1);
	}
	.tick {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: color-mix(in srgb, var(--paper) 70%, transparent);
	}
	.fill {
		position: absolute;
		inset: 0 auto 0 0;
		background: linear-gradient(90deg, var(--cs-deep), var(--cs-hot));
		box-shadow: 0 0 12px var(--cs-hot);
	}

	.player-row {
		display: flex;
		align-items: center;
		gap: 22px;
		padding: 6px 0 2px 5px;
	}
	.viz {
		flex: 1;
		min-width: 0;
	}

	.guess-row {
		display: flex;
		gap: 8px;
		align-items: flex-start;
	}
	.guess {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	.guess input {
		width: 100%;
		box-sizing: border-box;
		padding: 13px 16px;
		font-size: 1rem;
		border-radius: 12px;
		border: 1px solid var(--rule-firm);
		background: color-mix(in srgb, var(--paper) 85%, transparent);
		color: var(--ink);
		transition:
			border-color 0.2s ease,
			box-shadow 0.2s ease;
	}
	.guess input:focus {
		outline: none;
		border-color: var(--cs-hot);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--cs-hot) 20%, transparent);
	}
	.skip {
		flex: none;
		padding: 13px 16px;
		border-radius: 12px;
		border: 1px solid var(--rule-firm);
		background: color-mix(in srgb, var(--surface-2) 80%, transparent);
		color: var(--ink);
		font-weight: 600;
		cursor: pointer;
		transition: transform 0.12s ease;
	}
	.skip:hover {
		border-color: var(--cs-hot);
	}
	.skip:active {
		transform: scale(0.96);
	}
	.suggestions {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(100% + 6px);
		z-index: 5;
		margin: 0;
		padding: 6px;
		list-style: none;
		background: var(--surface);
		border: 1px solid var(--rule-firm);
		border-radius: 14px;
		box-shadow: 0 24px 50px -20px rgb(0 0 0 / 60%);
	}
	.suggestions button {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		padding: 8px 10px;
		border: none;
		border-radius: 9px;
		background: none;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}
	.suggestions button.highlighted {
		background: linear-gradient(90deg, color-mix(in srgb, var(--cs-hot) 25%, transparent), transparent);
	}
	.by {
		font-size: 0.82rem;
		color: var(--ink-faint);
	}

	.answer {
		position: relative;
		display: flex;
		gap: 18px;
		align-items: center;
		padding: 16px;
		border-radius: 16px;
		overflow: hidden;
		animation: reveal 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.2);
	}
	@keyframes reveal {
		from {
			opacity: 0;
			transform: scale(0.96);
		}
	}
	.answer-glow {
		position: absolute;
		inset: -40px;
		z-index: -1;
		background: var(--art, linear-gradient(135deg, var(--cs-hot), var(--cs-deep))) center / cover;
		filter: blur(40px) saturate(1.4);
		opacity: 0.55;
	}
	.answer img {
		flex: none;
		border-radius: 10px;
		object-fit: cover;
		box-shadow: 0 16px 34px -12px rgb(0 0 0 / 70%);
	}
	.answer-words {
		min-width: 0;
	}
	.answer-links {
		margin-top: 10px;
	}
	.answer h2 {
		margin: 2px 0;
		font-family: var(--display);
		font-size: 1.7rem;
		line-height: 1.1;
	}
	.answer p {
		margin: 2px 0;
	}
	.artist {
		font-weight: 600;
	}
	.album {
		font-size: 0.85rem;
		color: var(--ink-soft);
	}
	.verdict {
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	.answer.won .verdict {
		color: #3ddc84;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
	}
	.stats div {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 10px 4px;
		border-radius: 12px;
		background: color-mix(in srgb, var(--ink) 5%, transparent);
	}
	.stats strong {
		font-family: var(--display);
		font-size: 1.5rem;
	}
	.stats span {
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}
	.next {
		margin: 0;
		text-align: center;
		font-size: 0.85rem;
		color: var(--ink-faint);
	}
	.credit {
		margin: 0;
		font-size: 0.75rem;
		color: var(--ink-faint);
	}

	/* ---------------------------------------------------------- bloodlust (Phonk) */
	.bloodlust {
		--accent: #ff1f3d;
	}
	.bloodlust .title-text {
		background: linear-gradient(100deg, #ff1f3d, #ff9aa6 45%, #ff1f3d 60%, #7a0016);
		background-size: 250% 100%;
		-webkit-background-clip: text;
		background-clip: text;
		filter: drop-shadow(0 0 calc(10px + var(--level) * 30px) rgb(255 20 50 / 70%));
		animation:
			shimmer 3s ease-in-out infinite,
			jitter 2.4s steps(1) infinite;
	}
	@keyframes jitter {
		0%,
		92%,
		100% {
			transform: none;
		}
		93% {
			transform: translate(2px, -1px) skewX(-6deg);
		}
		95% {
			transform: translate(-3px, 1px) skewX(5deg);
		}
		97% {
			transform: translate(1px, 0);
		}
	}
	.mode {
		padding: 5px 12px;
		border-radius: 6px;
		font-family: var(--body);
		font-size: 0.8rem;
		font-weight: 800;
		letter-spacing: 0.3em;
		text-transform: uppercase;
		color: #fff;
		background: linear-gradient(135deg, #ff1f3d, #6b0012);
		box-shadow: 0 0 22px rgb(255 20 50 / 60%);
		animation: flicker 3.2s linear infinite;
	}
	@keyframes flicker {
		0%,
		18%,
		22%,
		60%,
		64%,
		100% {
			opacity: 1;
		}
		20%,
		62% {
			opacity: 0.35;
		}
	}
	.vignette {
		position: fixed;
		inset: 0;
		z-index: 1;
		pointer-events: none;
		box-shadow: inset 0 0 calc(90px + var(--level) * 220px) calc(10px + var(--level) * 50px) rgb(200 0 30 / calc(0.35 + var(--level) * 0.45));
		animation: breathe-red 2.6s ease-in-out infinite;
	}
	@keyframes breathe-red {
		50% {
			opacity: 0.7;
		}
	}
	.flash {
		position: fixed;
		inset: 0;
		z-index: 2;
		pointer-events: none;
		background: radial-gradient(circle, rgb(255 30 60 / 55%), rgb(120 0 20 / 75%));
		animation: flash 0.7s ease-out forwards;
	}
	@keyframes flash {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
		}
	}
	.bloodlust .content {
		animation: quake 0.45s ease-out;
	}
	.bloodlust .stage {
		border-color: rgb(255 31 61 / 35%);
		box-shadow:
			0 0 calc(30px + var(--level) * 60px) -10px rgb(255 20 50 / 55%),
			inset 0 1px 0 rgb(255 255 255 / 6%);
	}
	.stage.shake {
		animation: quake 0.4s ease-out;
	}
	.stage.shake[data-shake$='1'],
	.stage.shake[data-shake$='3'],
	.stage.shake[data-shake$='5'],
	.stage.shake[data-shake$='7'],
	.stage.shake[data-shake$='9'] {
		animation-name: quake-again;
	}
	@keyframes quake {
		0%,
		100% {
			transform: none;
		}
		20% {
			transform: translate(-6px, 2px) rotate(-0.4deg);
		}
		40% {
			transform: translate(5px, -2px) rotate(0.4deg);
		}
		60% {
			transform: translate(-3px, 1px);
		}
		80% {
			transform: translate(2px, 0);
		}
	}
	@keyframes quake-again {
		0%,
		100% {
			transform: none;
		}
		20% {
			transform: translate(6px, -2px) rotate(0.4deg);
		}
		40% {
			transform: translate(-5px, 2px) rotate(-0.4deg);
		}
		60% {
			transform: translate(3px, -1px);
		}
		80% {
			transform: translate(-2px, 0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.title-text,
		.mode,
		.vignette,
		.bloodlust .content,
		.stage.shake {
			animation: none !important;
		}
	}
	@media (max-width: 560px) {
		.player-row {
			gap: 14px;
		}
		.guess-row {
			flex-direction: column;
			align-items: stretch;
		}
		.stats strong {
			font-size: 1.2rem;
		}
	}
</style>
