<script lang="ts">
	/*
	 * Catasong → Guess the Anime: 15 s of an anime opening or ending (from where the song starts,
	 * or from any part of it), played as often as wanted; three guesses to name the anime.
	 * Everything about the round is on the server (src/lib/server/catasong/anime.ts); this page
	 * plays the sound it's given (lib/catasong/player.svelte.ts) and sends guesses.
	 *
	 * While a round is played, the next one is already asked for and its song fetched, so Next
	 * starts at once. Anime posters drift behind the page.
	 */
	import { untrack } from 'svelte';
	import CoverWall from '$lib/catasong/CoverWall.svelte';
	import PlayButton from '$lib/catasong/PlayButton.svelte';
	import SongLinks from '$lib/catasong/SongLinks.svelte';
	import Visualizer from '$lib/catasong/Visualizer.svelte';
	import VolumeSlider from '$lib/catasong/VolumeSlider.svelte';
	import { SongPlayer } from '$lib/catasong/player.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Level = (typeof data.levels)[number]['value'];
	type Kinds = 'op' | 'ed' | 'both';
	type Part = 'start' | 'any';
	type Name = { id: number; name: string; other: string | null };
	type Answer = {
		id: number;
		title: string;
		other: string | null;
		cover: string | null;
		year: number | null;
		theme: string;
		song: string | null;
		artist: string | null;
	};
	type RoundStart = { token: string; type: 'OP' | 'ED' };
	type Waiting = { waiting: true; have: number; progress: { done: number; of: number } | null };

	const SNIPPET = 15;
	const GUESSES = 3;

	const player = new SongPlayer();
	player.volume = untrack(() => data.volume);

	let level = $state<Level>('easy');
	let kinds = $state<Kinds>('both');
	let part = $state<Part>('start');
	let best = $state<Partial<Record<Level, number>>>(untrack(() => ({ ...data.best })));
	let posters = $state<string[]>([]);

	let started = $state(false);
	let token = $state<string | null>(null);
	let roundType = $state<'OP' | 'ED' | null>(null);
	let waiting = $state<Waiting | null>(null);
	let empty = $state(false);
	let snippetAt = 0;

	let wrong = $state<string[]>([]);
	let answer = $state<Answer | null>(null);
	let won = $state(false);
	let streak = $state(0);
	let score = $state(0);

	let names = $state<Name[]>([]);
	let typed = $state('');
	let highlighted = $state(0);
	let guessEl = $state<HTMLInputElement | null>(null);

	const audioUrl = (forToken: string) => `/api/catasong/anime/audio/${forToken}`;

	/* ------------------------------------------------------------ background and warm-up */

	async function loadPosters(forLevel: Level) {
		const response = await fetch(`/api/catasong/anime?do=posters&level=${forLevel}`).catch(() => null);
		const list = response?.ok ? ((await response.json()) as string[]) : [];
		if (list.length) posters = list;
	}

	$effect(() => {
		const forLevel = level;
		untrack(() => {
			void fetch(`/api/catasong/anime?do=warm&level=${forLevel}`).catch(() => null);
			void loadPosters(forLevel);
		});
	});

	/* ------------------------------------------------------------ rounds */

	let pollTimer: ReturnType<typeof setTimeout> | undefined;
	/** The next round, asked for while this one plays: { for: "level|kinds", round }. */
	let queued: { for: string; round: RoundStart } | null = null;

	async function askRound(): Promise<RoundStart | Waiting | { empty: true }> {
		const response = await fetch(`/api/catasong/anime?do=round&level=${level}&kinds=${kinds}`).catch(() => null);
		return response?.ok ? response.json() : { waiting: true, have: 0, progress: null };
	}

	async function queueNext() {
		const askedFor = `${level}|${kinds}`;
		const round = await askRound();
		if (`${level}|${kinds}` !== askedFor || !('token' in round)) return;
		queued = { for: askedFor, round };
		player.prefetch(audioUrl(round.token));
	}

	async function nextRound() {
		clearTimeout(pollTimer);
		player.clear();
		token = null;
		answer = null;
		won = false;
		wrong = [];
		typed = '';
		empty = false;
		const askedFor = `${level}|${kinds}`;
		let round: RoundStart | Waiting | { empty: true };
		if (queued && queued.for === askedFor) {
			round = queued.round;
			queued = null;
		} else {
			queued = null;
			round = await askRound();
		}
		if (`${level}|${kinds}` !== askedFor) return;
		if ('waiting' in round) {
			waiting = round;
			pollTimer = setTimeout(nextRound, 2000);
			return;
		}
		waiting = null;
		if ('empty' in round) {
			empty = true;
			return;
		}
		token = round.token;
		roundType = round.type;
		void refreshNames();
		const loaded = await player.load(audioUrl(round.token));
		if (token !== round.token || !loaded || !player.buffer) return;
		// "Any part": somewhere that still leaves a whole snippet before the end.
		const room = Math.max(0, player.buffer.duration - player.songStart - SNIPPET - 1);
		snippetAt = part === 'any' ? Math.random() * room : 0;
		player.play(SNIPPET, snippetAt);
		guessEl?.focus();
		void queueNext();
	}

	async function refreshNames() {
		const response = await fetch('/api/catasong/anime?do=names').catch(() => null);
		if (response?.ok) names = await response.json();
	}

	function start() {
		started = true;
		void nextRound();
	}

	function changeLevel(to: Level) {
		if (to === level) return;
		streak = 0;
		level = to;
		if (started) void nextRound();
	}

	function changeKinds(to: Kinds) {
		if (to === kinds) return;
		kinds = to;
		if (started && !answer) void nextRound();
	}

	function changePart(to: Part) {
		if (to === part) return;
		part = to;
		if (started && !answer) void nextRound();
	}

	function pressPlay() {
		if (player.playing) player.stop();
		else if (answer) player.play(player.buffer ? player.buffer.duration : 90);
		else player.play(SNIPPET, snippetAt);
	}

	async function noteBest() {
		if (streak <= (best[level] ?? 0)) return;
		best = { ...best, [level]: streak };
		await fetch('/api/catasong/anime', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ level, streak })
		}).catch(() => null);
	}

	async function send(id: number | null, text: string) {
		if (!token || answer) return;
		const response = await fetch('/api/catasong/anime', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token, id })
		}).catch(() => null);
		if (!response?.ok) return;
		const result = (await response.json()) as { right: boolean; answer?: Answer };
		typed = '';
		highlighted = 0;
		if (result.right && result.answer) {
			answer = result.answer;
			won = true;
			score += GUESSES - wrong.length;
			streak++;
			void noteBest();
			if (!player.playing) player.play(player.buffer ? player.buffer.duration : 90);
			return;
		}
		if (id !== null) wrong = [...wrong, text];
		if (id === null || wrong.length >= GUESSES) {
			answer = result.answer ?? (await reveal());
			won = false;
			streak = 0;
			if (!player.playing) player.play(player.buffer ? player.buffer.duration : 90);
		} else guessEl?.focus();
	}

	async function reveal(): Promise<Answer | null> {
		const response = await fetch('/api/catasong/anime', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token, id: null })
		}).catch(() => null);
		return response?.ok ? (((await response.json()) as { answer?: Answer }).answer ?? null) : null;
	}

	/* ------------------------------------------------------------ the guess box */

	const plain = (text: string) =>
		text
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^\p{L}\p{N}]+/gu, ' ')
			.trim();

	const suggestions = $derived.by(() => {
		const query = plain(typed);
		if (query.length < 2) return [];
		const words = query.split(' ');
		const scored: { name: Name; score: number }[] = [];
		for (const name of names) {
			const a = plain(name.name);
			const b = name.other ? plain(name.other) : '';
			const hit = (text: string) => words.every((word) => text.includes(word));
			if (!hit(a) && !hit(b)) continue;
			const score = a.startsWith(query) || b.startsWith(query) ? 0 : 1;
			scored.push({ name, score: score * 1000 + a.length });
		}
		return scored.sort((x, y) => x.score - y.score).slice(0, 8).map((s) => s.name);
	});

	function onGuessKey(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			highlighted = Math.min(highlighted + 1, suggestions.length - 1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			highlighted = Math.max(highlighted - 1, 0);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const pick = suggestions[highlighted];
			if (pick) void send(pick.id, pick.name);
		}
	}

	function onPageKey(event: KeyboardEvent) {
		if (event.key === 'Enter' && answer && document.activeElement?.tagName !== 'INPUT') {
			event.preventDefault();
			void nextRound();
		}
	}

	$effect(() => () => {
		clearTimeout(pollTimer);
		player.close();
	});

	const waitingLine = $derived.by(() => {
		if (!waiting) return '';
		if (waiting.progress && waiting.progress.of) return `Matching your anime · ${waiting.progress.done} of ${waiting.progress.of}`;
		return waiting.have ? `Getting the songs ready · ${waiting.have} anime so far` : 'Getting the songs ready';
	});
</script>

<svelte:head>
	<title>Guess the Anime</title>
</svelte:head>

<svelte:window onkeydown={onPageKey} />

<div class="page" style="--cs-hot: #ff7ad9; --cs-deep: #6a5bff">
	<CoverWall covers={posters} tall />

	<div class="content">
		<a class="back" href="/catasong">← Catasong</a>

		<header class="top">
			<h1 class="title">Guess the Anime</h1>
			<p class="lede">15 seconds of an opening or ending. Three guesses.</p>
		</header>

		<div class="pickers">
			<div class="choice-row" role="group" aria-label="Level">
				{#each data.levels as option (option.value)}
					<button type="button" class="chip" class:active={level === option.value} onclick={() => changeLevel(option.value)}>
						{option.label}
						{#if best[option.value]}<span class="best tabular">{best[option.value]}</span>{/if}
					</button>
				{/each}
			</div>
			<div class="choice-row">
				<div class="seg" role="group" aria-label="Songs">
					<button type="button" class:active={kinds === 'both'} onclick={() => changeKinds('both')}>Both</button>
					<button type="button" class:active={kinds === 'op'} onclick={() => changeKinds('op')}>Openings</button>
					<button type="button" class:active={kinds === 'ed'} onclick={() => changeKinds('ed')}>Endings</button>
				</div>
				<div class="seg" role="group" aria-label="Which part">
					<button type="button" class:active={part === 'start'} onclick={() => changePart('start')}>From the start</button>
					<button type="button" class:active={part === 'any'} onclick={() => changePart('any')}>Any part</button>
				</div>
			</div>
		</div>

		<section class="stage">
			<div class="stage-top">
				<div class="stats tabular">
					<span class="stat"><strong>{streak}</strong> streak</span>
					<span class="stat"><strong>{score}</strong> score</span>
					{#if best[level]}<span class="stat faint">best {best[level]}</span>{/if}
				</div>
				<VolumeSlider {player} />
			</div>

			{#if !started}
				<div class="intro">
					<button type="button" class="start" onclick={start}>Start</button>
				</div>
			{:else if waiting}
				<div class="intro">
					<p class="waiting-line">{waitingLine}</p>
					{#if waiting.progress && waiting.progress.of}
						<div class="progress"><span style="width: {(waiting.progress.done / waiting.progress.of) * 100}%"></span></div>
					{:else}
						<div class="progress indeterminate"><span></span></div>
					{/if}
				</div>
			{:else if empty}
				<p class="note">{level === 'mine' ? 'No songs for the anime in your library yet.' : 'No songs for this level right now.'}</p>
			{:else}
				<div class="player-row">
					<PlayButton
						{player}
						label={!token || player.loading ? '…' : player.playing ? 'Stop' : answer ? 'Hear it all' : 'Play again'}
						sub={player.loading || !token ? 'Loading the song' : player.failed ? "Didn't load" : roundType === 'ED' ? 'An ending' : 'An opening'}
						disabled={!token || player.loading}
						onclick={pressPlay}
					/>
					<div class="viz"><Visualizer {player} /></div>
				</div>

				{#if player.failed}
					<button type="button" class="ghost" onclick={nextRound}>Another song</button>
				{/if}

				{#if !answer && token}
					<div class="guess-row">
						<div class="guess">
							<input
								bind:this={guessEl}
								bind:value={typed}
								oninput={() => (highlighted = 0)}
								onkeydown={onGuessKey}
								type="text"
								placeholder={roundType === 'ED' ? 'Which anime is this ending from?' : 'Which anime is this opening from?'}
								aria-label="Your guess"
								autocomplete="off"
								spellcheck="false"
							/>
							{#if suggestions.length}
								<ul class="suggestions" role="listbox">
									{#each suggestions as name, i (name.id)}
										<li role="option" aria-selected={i === highlighted}>
											<button type="button" class:highlighted={i === highlighted} onmouseenter={() => (highlighted = i)} onclick={() => send(name.id, name.name)}>
												<span>{name.name}</span>
												{#if name.other}<span class="by">{name.other}</span>{/if}
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
						<button type="button" class="ghost" onclick={() => send(null, '')}>Give up</button>
					</div>
					<div class="lives" aria-label="{GUESSES - wrong.length} guesses left">
						{#each Array(GUESSES) as _, i (i)}
							<span class="life" class:lost={i < wrong.length}></span>
						{/each}
					</div>
				{/if}

				{#if wrong.length}
					<ol class="tries">
						{#each wrong as tried, i (i)}
							<li><span class="slot">{i + 1}</span><span class="text">{tried}</span></li>
						{/each}
					</ol>
				{/if}

				{#if answer}
					<div class="answer" class:won style={answer.cover ? `--art: url(${answer.cover})` : ''}>
						<div class="answer-glow" aria-hidden="true"></div>
						{#if answer.cover}<img src={answer.cover} alt="" width="100" height="142" />{/if}
						<div class="answer-words">
							<p class="verdict">{won ? (wrong.length ? `Got it on guess ${wrong.length + 1}` : 'First guess') : 'The answer'}</p>
							<h2>{answer.title}</h2>
							{#if answer.other}<p class="other">{answer.other}</p>{/if}
							<p class="theme">
								{answer.theme}{answer.song ? ` · ${answer.song}` : ''}{answer.artist ? ` · ${answer.artist}` : ''}{answer.year ? ` · ${answer.year}` : ''}
							</p>
							<div class="answer-actions">
								<button type="button" class="next" onclick={nextRound}>Next</button>
								<a class="open" href="/title/anilist/{answer.id}">Open</a>
							</div>
							{#if answer.song}
								<div class="answer-links"><SongLinks song={answer.song} artist={answer.artist} extra={answer.artist ? '' : answer.title} /></div>
							{/if}
						</div>
					</div>
				{/if}
			{/if}
		</section>

		<p class="credit">Songs from AnimeThemes.</p>
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
	.back {
		align-self: flex-start;
		font-size: 0.85rem;
		color: var(--ink-soft);
		text-decoration: none;
		padding: 6px 12px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--surface) 65%, transparent);
		backdrop-filter: blur(8px);
	}
	.back:hover {
		color: var(--ink);
	}
	.title {
		margin: 0;
		font-family: var(--display);
		font-size: clamp(2.4rem, 6.5vw, 3.6rem);
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
	.lede {
		margin: 8px 0 0;
		color: var(--ink-soft);
	}
	.pickers {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.choice-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 7px;
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
	.best {
		font-size: 0.72rem;
		padding: 1px 7px;
		border-radius: 999px;
		background: rgb(0 0 0 / 22%);
	}
	.seg {
		display: inline-flex;
		padding: 3px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--surface) 70%, transparent);
		border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
		backdrop-filter: blur(8px);
	}
	.seg button {
		padding: 6px 14px;
		border: none;
		border-radius: 999px;
		background: none;
		color: var(--ink-soft);
		font-weight: 600;
		font-size: 0.88rem;
		cursor: pointer;
		transition:
			background 0.2s ease,
			color 0.2s ease;
	}
	.seg button.active {
		color: var(--ink);
		background: color-mix(in srgb, var(--cs-hot) 28%, var(--surface-2));
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cs-hot) 50%, transparent);
	}

	.stage {
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
	}
	.stage-top {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
	}
	.stats {
		display: flex;
		gap: 16px;
		font-size: 0.85rem;
		color: var(--ink-faint);
	}
	.stat strong {
		font-family: var(--display);
		font-size: 1.25rem;
		color: var(--ink);
		margin-right: 3px;
	}
	.intro {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		padding: 34px 0;
	}
	.start {
		padding: 16px 54px;
		font-size: 1.2rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		border: none;
		border-radius: 999px;
		color: #fff;
		background: linear-gradient(135deg, var(--cs-hot), var(--cs-deep));
		box-shadow: 0 16px 40px -14px var(--cs-hot);
		cursor: pointer;
		transition: transform 0.15s ease;
		animation: pulse 2.4s ease-in-out infinite;
	}
	.start:hover {
		transform: scale(1.05);
	}
	@keyframes pulse {
		50% {
			box-shadow: 0 16px 60px -8px var(--cs-hot);
		}
	}
	.waiting-line {
		margin: 0;
		color: var(--ink-soft);
	}
	.progress {
		width: min(320px, 80%);
		height: 6px;
		border-radius: 3px;
		background: color-mix(in srgb, var(--ink) 10%, transparent);
		overflow: hidden;
	}
	.progress span {
		display: block;
		height: 100%;
		background: linear-gradient(90deg, var(--cs-deep), var(--cs-hot));
		transition: width 0.5s ease;
	}
	.progress.indeterminate span {
		width: 35%;
		animation: slide 1.2s ease-in-out infinite;
	}
	@keyframes slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(300%);
		}
	}
	.note {
		margin: 0;
		color: var(--ink-soft);
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
	.ghost {
		flex: none;
		align-self: flex-start;
		padding: 13px 16px;
		border-radius: 12px;
		border: 1px solid var(--rule-firm);
		background: color-mix(in srgb, var(--surface-2) 80%, transparent);
		color: var(--ink-soft);
		font-weight: 600;
		cursor: pointer;
	}
	.ghost:hover {
		color: var(--ink);
		border-color: var(--cs-hot);
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
	.lives {
		display: flex;
		gap: 6px;
	}
	.life {
		width: 34px;
		height: 6px;
		border-radius: 3px;
		background: linear-gradient(90deg, var(--cs-hot), var(--cs-deep));
		transition:
			opacity 0.3s ease,
			transform 0.3s ease;
	}
	.life.lost {
		opacity: 0.18;
		transform: scaleX(0.6);
	}
	.tries {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.tries li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 12px 6px 6px;
		border-radius: 10px;
		border: 1px solid color-mix(in srgb, #e5484d 50%, transparent);
		background: color-mix(in srgb, #e5484d 13%, var(--sunk));
		font-size: 0.92rem;
		animation: land 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.3);
	}
	@keyframes land {
		from {
			transform: translateX(-10px);
			opacity: 0;
		}
	}
	.slot {
		flex: none;
		width: 26px;
		padding: 3px 0;
		text-align: center;
		border-radius: 7px;
		font-size: 0.78rem;
		font-weight: 700;
		color: #fff;
		background: #e5484d;
	}
	.tries .text {
		text-decoration: line-through;
		color: var(--ink-soft);
	}
	.answer {
		position: relative;
		display: flex;
		gap: 18px;
		align-items: center;
		padding: 16px;
		border-radius: 16px;
		overflow: hidden;
		isolation: isolate;
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
		opacity: 0.5;
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
	.answer h2 {
		margin: 2px 0;
		font-family: var(--display);
		font-size: 1.6rem;
		line-height: 1.1;
	}
	.answer p {
		margin: 2px 0;
	}
	.other {
		color: var(--ink-soft);
		font-size: 0.9rem;
	}
	.theme {
		font-size: 0.88rem;
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
	.answer-actions {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}
	.answer-links {
		margin-top: 8px;
	}
	.next {
		padding: 9px 22px;
		border: none;
		border-radius: 999px;
		color: #fff;
		font-weight: 700;
		background: linear-gradient(135deg, var(--cs-hot), var(--cs-deep));
		box-shadow: 0 10px 26px -12px var(--cs-hot);
		cursor: pointer;
		transition: transform 0.12s ease;
	}
	.next:hover {
		transform: translateY(-1px);
	}
	.open {
		padding: 9px 18px;
		border-radius: 999px;
		color: var(--ink);
		text-decoration: none;
		background: color-mix(in srgb, var(--surface) 70%, transparent);
		border: 1px solid color-mix(in srgb, var(--ink) 15%, transparent);
	}
	.credit {
		margin: 0;
		font-size: 0.75rem;
		color: var(--ink-faint);
	}
	@media (prefers-reduced-motion: reduce) {
		.title,
		.start {
			animation: none;
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
	}
</style>
