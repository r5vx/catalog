<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { wording } from '$lib/altText';
	import { watchHref } from '$lib/friendLinks';
	import type { SearchResult } from '$lib/server/metadata/types';

	/**
	 * Browse → Random (owner, 2026-11-15: "more fun ... some lootbox ... it does like an opening
	 * animation and the random thing pops out"): a window in the middle of the screen with a box.
	 * Clicked, the box shakes while the pick is asked for (src/routes/api/browse/random), its lid
	 * flies off and the poster comes out in a burst of light, colored by how well rated it is
	 * (gold 8.3+, purple 7.6+, blue 6.8+, silver below), like a loot box's rarity. Then: Watch now,
	 * Want to watch, Completed, Open, or Roll again. Under the box: film, series or anime; really
	 * random anime (any of TMDB's, not only popular ones; off unless turned on); leave out what's
	 * in the library (on); only the genre Browse is showing. Those are kept in settings.
	 */
	type Kind = 'movies' | 'tv' | 'anime';
	type Phase = 'idle' | 'shaking' | 'opening' | 'shown' | 'failed';
	let { cat = '', genre = null, genreName = '' }: { cat?: string; genre?: number | null; genreName?: string } = $props();

	const KINDS: { value: Kind; label: string }[] = [
		{ value: 'movies', label: 'Movie' },
		{ value: 'tv', label: 'TV show' },
		{ value: 'anime', label: 'Anime' }
	];

	let open = $state(false);
	let phase = $state<Phase>('idle');
	let kind = $state<Kind>('movies');
	let deep = $state(false);
	/** No box to open: the pick comes straight out (the window's "Skip the box"). */
	let quick = $state(false);
	let leaveOutLibrary = $state(true);
	let useGenre = $state(true);
	// (Raw: a $state object is a proxy, and `pick === found` below was never true, so it never settled.)
	let pick = $state.raw<SearchResult | null>(null);
	let problem = $state('');
	/** What it was added to the library as ('' not yet), or a problem doing so. */
	let added = $state('');
	let adding = $state(false);
	let crateEl = $state<HTMLButtonElement | null>(null);
	let saved: { kind: Kind; deep: boolean; library: boolean; quick: boolean } | null = null;

	const t = (text: string) => wording(page.data.altMode, text);
	const here = $derived(page.url.pathname + page.url.search);
	const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const wait = (ms: number) => new Promise((done) => setTimeout(done, reducedMotion() ? 0 : ms));

	/** The light's color: how well rated it is. */
	const tier = $derived.by(() => {
		const rating = pick?.externalRating ?? 0;
		if (phase !== 'opening' && phase !== 'shown') return 'var(--accent)';
		return rating >= 8.3 ? '#f5c542' : rating >= 7.6 ? '#b07cff' : rating >= 6.8 ? '#4fa9ff' : '#cfd8d3';
	});

	const isFilm = (result: SearchResult) => result.sourceId.startsWith('movie:') || (!result.sourceId.startsWith('tv:') && result.categorySlug === 'movies');
	const link = (result: SearchResult) => `/title/${result.source}/${encodeURIComponent(result.sourceId)}?back=${encodeURIComponent(here)}`;
	const watchLink = (result: SearchResult) => watchHref({ title: result.title, type: isFilm(result) ? 'movie' : 'tv', year: result.year });

	onMount(() => {
		fetch('/api/browse/random?prefs=1')
			.then((r) => (r.ok ? r.json() : null))
			.then((answer) => (saved = answer?.prefs ?? null))
			.catch(() => {});
	});

	async function openWindow() {
		open = true;
		// The part of Browse you're in comes first (anime while browsing anime), else the last one picked.
		kind = cat === 'tv' || cat === 'anime' ? cat : cat === 'movies' ? 'movies' : (saved?.kind ?? 'movies');
		deep = saved?.deep ?? false;
		quick = saved?.quick ?? false;
		leaveOutLibrary = !(saved?.library ?? false);
		useGenre = true;
		reset();
		await tick();
		if (quick) void roll();
		else crateEl?.focus();
	}

	function close() {
		open = false;
	}

	function reset() {
		phase = 'idle';
		pick = null;
		problem = '';
		added = '';
	}

	function keep() {
		saved = { kind, deep, library: !leaveOutLibrary, quick };
		void fetch('/api/browse/random', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saved) }).catch(() => {});
	}

	function setKind(value: Kind) {
		kind = value;
		keep();
	}

	/** A poster loaded before it's shown, so it doesn't come out of the box blank. */
	const preload = (src: string | null) =>
		new Promise<void>((done) => {
			if (!src) return done();
			const image = new Image();
			image.onload = image.onerror = () => done();
			image.src = src;
			setTimeout(done, 4000);
		});

	async function roll() {
		if (phase === 'shaking' || phase === 'opening') return;
		reset();
		phase = 'shaking';
		const params = new URLSearchParams({ kind });
		if (genre && useGenre) params.set('genre', String(genre));
		if (deep) params.set('deep', '1');
		if (!leaveOutLibrary) params.set('library', '1');
		const asked = fetch(`/api/browse/random?${params}`)
			.then((r) => (r.ok ? r.json() : null))
			.then(async (answer) => {
				const found = (answer?.pick ?? null) as SearchResult | null;
				if (found) await preload(found.posterUrl);
				return found;
			})
			.catch(() => null);
		// (It shakes at least this long, so the opening is worth watching even when TMDB is quick.)
		const [found] = await Promise.all([asked, quick ? null : wait(1100)]);
		if (!open) return;
		if (!found) {
			phase = 'failed';
			problem = t('Nothing came back. Try again in a moment.');
			return;
		}
		pick = found;
		if (quick) {
			phase = 'shown';
			return;
		}
		phase = 'opening';
		await wait(950);
		if (open && pick === found) phase = 'shown';
	}

	async function addAs(status: 'planned' | 'completed') {
		if (!pick || adding) return;
		adding = true;
		const response = await fetch('/api/add', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ source: pick.source, sourceId: pick.sourceId, status })
		}).catch(() => null);
		adding = false;
		added = response?.ok ? (status === 'planned' ? t('Added to Want to watch') : t('Added as Completed')) : t("Couldn't add it");
	}

	function onKey(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			event.preventDefault();
			close();
		}
	}

	/** Bits of light flying out, each its own way. */
	const SPARKS = Array.from({ length: 16 }, (_, i) => ({ angle: (360 / 16) * i + (i % 2 ? 8 : -6), far: 120 + ((i * 37) % 70), size: 4 + (i % 3) * 2, delay: (i % 4) * 30 }));
</script>

<svelte:window onkeydown={onKey} />

<!-- Brighter than the buttons around it, so it's noticed (owner: "just a grey box no one will pay attention to"). -->
<button type="button" class="random-button" onclick={openWindow}>
	<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true">
		<rect x="3.5" y="3.5" width="17" height="17" rx="4" />
		<circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
		<circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
		<circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
		<circle cx="8.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
		<circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
	</svg>
	{t('Random')}
</button>

{#if open}
	<!-- (Only a press on the dimmed part itself closes it: never one inside the window.) -->
	<div class="shade" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
		<div class="window" role="dialog" aria-modal="true" aria-label="Random" style:--tier={tier}>
			<button type="button" class="close" onclick={close} aria-label="Close">
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
			</button>

			<div class="stage" class:revealed={phase === 'opening' || phase === 'shown'}>
				{#if phase === 'opening' || phase === 'shown'}
					<div class="burst" aria-hidden="true">
						<div class="rays"></div>
						<div class="glow"></div>
						{#each SPARKS as spark, i (i)}
							<span class="spark" style:--angle="{spark.angle}deg" style:--far="{spark.far}px" style:--size="{spark.size}px" style:--delay="{spark.delay}ms"></span>
						{/each}
					</div>
				{/if}

				{#if quick && phase !== 'shown'}
					<div class="quick">
						{#if phase === 'shaking'}
							<p class="hint">{t('Picking one…')}</p>
						{:else}
							{#if phase === 'failed'}<p class="hint">{problem}</p>{/if}
							<button type="button" class="btn btn-primary" onclick={roll}>{t('Pick one')}</button>
						{/if}
					</div>
				{:else if phase !== 'shown'}
					<button
						type="button"
						class="crate"
						class:shaking={phase === 'shaking'}
						class:opening={phase === 'opening'}
						bind:this={crateEl}
						onclick={roll}
						disabled={phase === 'shaking' || phase === 'opening'}
						aria-label={t('Open the box')}
					>
						<svg viewBox="0 0 200 200" aria-hidden="true">
							<defs>
								<linearGradient id="crate-body" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0" class="body-top" />
									<stop offset="1" class="body-bottom" />
								</linearGradient>
								<linearGradient id="crate-lid" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0" class="lid-top" />
									<stop offset="1" class="lid-bottom" />
								</linearGradient>
							</defs>
							<ellipse class="floor" cx="100" cy="186" rx="70" ry="8" />
							<g class="body">
								<rect x="32" y="96" width="136" height="84" rx="8" fill="url(#crate-body)" />
								<rect class="ribbon" x="90" y="96" width="20" height="84" />
								<rect class="shine" x="40" y="104" width="10" height="64" rx="5" />
							</g>
							<g class="lid">
								<rect x="24" y="74" width="152" height="28" rx="7" fill="url(#crate-lid)" />
								<rect class="ribbon" x="90" y="74" width="20" height="28" />
								<path class="bow" d="M100 74 C 82 52, 58 56, 66 70 C 72 80, 90 76, 100 74 Z" />
								<path class="bow" d="M100 74 C 118 52, 142 56, 134 70 C 128 80, 110 76, 100 74 Z" />
								<circle class="knot" cx="100" cy="73" r="7" />
							</g>
						</svg>
					</button>
					<p class="hint">
						{#if phase === 'idle'}{t('Click the box')}{:else if phase === 'failed'}{problem}{:else}&nbsp;{/if}
					</p>
				{/if}

				{#if pick && (phase === 'opening' || phase === 'shown')}
					<div class="prize" class:settled={phase === 'shown'}>
						<a href={link(pick)} class="poster" onclick={close}>
							{#if pick.posterUrl}<img src={pick.posterUrl} alt="" />{:else}<span class="no-poster">{pick.title}</span>{/if}
						</a>
						{#if phase === 'shown'}
							<div class="about">
								<a href={link(pick)} class="title" onclick={close}>{pick.title}</a>
								<span class="meta">
									{pick.year ?? ''}{pick.kind ? ` · ${pick.kind}` : ''}
									{#if pick.externalRating}<span class="score">★ {pick.externalRating.toFixed(1)}</span>{/if}
								</span>
								{#if pick.overview}<p class="overview">{pick.overview}</p>{/if}
								<div class="row">
									<a href={watchLink(pick)} class="btn btn-primary" onclick={close}>{t('Watch now')}</a>
									<a href={link(pick)} class="btn" onclick={close}>{t('Open')}</a>
								</div>
								{#if added}
									<p class="added">{added}</p>
								{:else}
									<div class="row">
										<button type="button" class="btn" disabled={adding} onclick={() => addAs('planned')}>{t('Want to watch')}</button>
										<button type="button" class="btn" disabled={adding} onclick={() => addAs('completed')}>{t('Completed')}</button>
									</div>
								{/if}
								<button type="button" class="btn again" onclick={roll}>{t('Roll again')}</button>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<div class="choices">
				<div class="kinds" role="radiogroup" aria-label="What kind">
					{#each KINDS as option (option.value)}
						<button type="button" class="kind" class:on={kind === option.value} role="radio" aria-checked={kind === option.value} onclick={() => setKind(option.value)}>
							{t(option.label)}
						</button>
					{/each}
				</div>
				<div class="toggles">
					<label><input type="checkbox" bind:checked={deep} onchange={keep} /> {t('Really random (not only popular ones)')}</label>
					<label><input type="checkbox" bind:checked={quick} onchange={keep} /> {t('Skip the box')}</label>
					<label><input type="checkbox" bind:checked={leaveOutLibrary} onchange={keep} /> {t("Leave out what's in my library")}</label>
					{#if genre && genreName}
						<label><input type="checkbox" bind:checked={useGenre} /> {t('Only')} {genreName}</label>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.random-button {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 8px 15px;
		border: 0;
		border-radius: 999px;
		font: inherit;
		font-weight: 650;
		cursor: pointer;
		color: var(--accent-ink);
		background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #ffd36e));
		box-shadow: 0 2px 10px -3px color-mix(in srgb, var(--accent) 70%, transparent);
		transition: transform 0.15s ease, box-shadow 0.15s ease;
	}
	.random-button:hover {
		transform: translateY(-1px);
		box-shadow: 0 5px 16px -4px color-mix(in srgb, var(--accent) 80%, transparent);
	}
	.random-button:hover svg {
		animation: tumble 0.6s ease;
	}
	.random-button:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
	}
	@keyframes tumble {
		40% { transform: rotate(-18deg) scale(1.1); }
		100% { transform: rotate(360deg); }
	}
	.quick {
		min-height: 120px;
		display: grid;
		place-items: center;
		align-content: center;
		gap: 10px;
	}
	.shade {
		position: fixed;
		inset: 0;
		z-index: 3000;
		display: grid;
		place-items: center;
		padding: 16px;
		background: rgb(0 0 0 / 0.55);
		animation: fade 0.18s ease-out;
	}

	.window {
		position: relative;
		width: min(640px, 100%);
		max-height: calc(100vh - 32px);
		overflow: auto;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 18px 20px 20px;
		border: 1px solid var(--rule);
		border-radius: calc(var(--radius) * 1.5);
		background: var(--surface);
		box-shadow: 0 24px 70px rgb(0 0 0 / 0.45);
		animation: rise 0.22s ease-out;
	}

	.close {
		position: absolute;
		top: 10px;
		right: 10px;
		z-index: 3;
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.close:hover {
		background: var(--surface-2);
		color: var(--ink);
	}

	/* ---------------------------------------------------------- the box */

	.stage {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 330px;
		overflow: hidden;
		border-radius: var(--radius);
		background: radial-gradient(circle at 50% 60%, color-mix(in srgb, var(--tier) 22%, transparent), transparent 65%), var(--surface-2);
		transition: background 0.4s;
	}

	.crate {
		position: relative;
		z-index: 2;
		width: 210px;
		height: 210px;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
		animation: float 3s ease-in-out infinite;
		filter: drop-shadow(0 0 18px color-mix(in srgb, var(--tier) 45%, transparent));
	}

	.crate:hover:not(:disabled) svg {
		transform: scale(1.05) rotate(-2deg);
	}

	.crate:disabled {
		cursor: default;
	}

	.crate svg {
		width: 100%;
		height: 100%;
		overflow: visible;
		transition: transform 0.2s;
	}

	.body-top {
		stop-color: color-mix(in srgb, var(--accent) 88%, white);
	}

	.body-bottom {
		stop-color: color-mix(in srgb, var(--accent) 62%, black);
	}

	.lid-top {
		stop-color: color-mix(in srgb, var(--accent) 70%, white);
	}

	.lid-bottom {
		stop-color: color-mix(in srgb, var(--accent) 80%, black);
	}

	.ribbon,
	.bow {
		fill: #fff4d6;
	}

	.knot {
		fill: #f3d488;
	}

	.shine {
		fill: rgb(255 255 255 / 0.22);
	}

	.floor {
		fill: rgb(0 0 0 / 0.18);
	}

	.lid {
		transform-box: fill-box;
		transform-origin: 50% 100%;
	}

	/* Waiting for the pick: it rattles. */
	.crate.shaking {
		animation: none;
	}

	.crate.shaking svg {
		animation: shake 0.32s linear infinite;
	}

	.crate.shaking .lid {
		animation: rattle 0.32s linear infinite;
	}

	/* Open: the lid flies off and the box sinks away. */
	.crate.opening {
		animation: sink 0.9s ease-in forwards;
	}

	.crate.opening .lid {
		animation: lid-off 0.6s cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
	}

	.hint {
		position: relative;
		z-index: 2;
		margin: 6px 0 0;
		min-height: 1.3em;
		color: var(--ink-soft);
		font-size: 0.9rem;
	}

	/* ---------------------------------------------------------- the light */

	.burst {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
	}

	.rays {
		position: absolute;
		width: 760px;
		height: 760px;
		background: repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--tier) 34%, transparent) 0deg 7deg, transparent 7deg 22deg);
		mask-image: radial-gradient(circle, black 18%, transparent 62%);
		animation: rays-in 0.5s ease-out, spin 14s linear infinite;
		transition: opacity 0.6s;
	}

	/* Landed: the light settles down so the words over it read easily. */
	.stage:has(.prize.settled) .rays {
		opacity: 0.4;
	}

	.stage:has(.prize.settled) .glow {
		opacity: 0.2;
	}

	.glow {
		position: absolute;
		width: 260px;
		height: 260px;
		border-radius: 50%;
		background: radial-gradient(circle, color-mix(in srgb, var(--tier) 75%, white) 0%, color-mix(in srgb, var(--tier) 40%, transparent) 40%, transparent 70%);
		animation: flash 0.9s ease-out forwards;
	}

	.spark {
		position: absolute;
		width: var(--size);
		height: var(--size);
		border-radius: 50%;
		background: color-mix(in srgb, var(--tier) 70%, white);
		box-shadow: 0 0 8px var(--tier);
		opacity: 0;
		animation: spark 0.9s ease-out var(--delay) forwards;
	}

	/* ---------------------------------------------------------- what came out */

	.prize {
		position: absolute;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 18px;
		animation: pop 0.75s cubic-bezier(0.18, 0.9, 0.3, 1.15) both;
	}

	.prize.settled {
		position: relative;
		align-items: flex-start;
		width: 100%;
		padding: 18px;
		animation: none;
	}

	.poster {
		flex: none;
		display: block;
		width: 170px;
		aspect-ratio: 2 / 3;
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--sunk);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--tier) 80%, transparent), 0 0 34px color-mix(in srgb, var(--tier) 55%, transparent), 0 14px 30px rgb(0 0 0 / 0.35);
	}

	.poster img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.no-poster {
		display: grid;
		place-items: center;
		height: 100%;
		padding: 10px;
		text-align: center;
		font-weight: 600;
	}

	.about {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
		animation: fade 0.3s ease-out;
	}

	.title {
		font-family: var(--display);
		font-size: 1.45rem;
		font-weight: 600;
		line-height: 1.15;
		color: var(--ink);
	}

	.title:hover {
		color: var(--accent);
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		color: var(--ink-soft);
		font-size: 0.88rem;
	}

	.score {
		color: var(--tier);
		font-weight: 700;
		text-shadow: 0 0 10px color-mix(in srgb, var(--tier) 45%, transparent);
	}

	.overview {
		margin: 0;
		font-size: 0.88rem;
		color: var(--ink-soft);
		display: -webkit-box;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.added {
		margin: 0;
		color: var(--good);
		font-size: 0.88rem;
		font-weight: 600;
	}

	.again {
		align-self: flex-start;
		margin-top: 4px;
	}

	/* ---------------------------------------------------------- choices */

	.choices {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.kinds {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 4px;
		padding: 4px;
		border-radius: var(--radius);
		background: var(--surface-2);
	}

	.kind {
		padding: 8px 6px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-soft);
		font: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}

	.kind:hover {
		color: var(--ink);
	}

	.kind.on {
		background: var(--surface);
		color: var(--ink);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.18);
	}

	.toggles {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 18px;
		font-size: 0.88rem;
		color: var(--ink-soft);
	}

	.toggles label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
	}

	.toggles input {
		width: auto;
	}

	@media (max-width: 560px) {
		.prize.settled {
			flex-direction: column;
			align-items: center;
			text-align: center;
		}

		.prize.settled .row,
		.again {
			justify-content: center;
			align-self: center;
		}

		.meta {
			justify-content: center;
		}
	}

	/* ---------------------------------------------------------- motion */

	@keyframes fade {
		from {
			opacity: 0;
		}
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(14px) scale(0.98);
		}
	}

	@keyframes float {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-8px);
		}
	}

	@keyframes shake {
		0% {
			transform: rotate(0) translateX(0);
		}
		25% {
			transform: rotate(-5deg) translateX(-4px);
		}
		50% {
			transform: rotate(0) translateX(0);
		}
		75% {
			transform: rotate(5deg) translateX(4px);
		}
		100% {
			transform: rotate(0) translateX(0);
		}
	}

	@keyframes rattle {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-6px) rotate(-2deg);
		}
	}

	@keyframes lid-off {
		to {
			transform: translate(70px, -190px) rotate(48deg);
			opacity: 0;
		}
	}

	@keyframes sink {
		30% {
			transform: translateY(-6px) scale(1.04);
			opacity: 1;
		}
		100% {
			transform: translateY(90px) scale(0.7);
			opacity: 0;
		}
	}

	@keyframes pop {
		0% {
			opacity: 0;
			transform: translateY(60px) scale(0.2) rotateY(180deg);
		}
		60% {
			opacity: 1;
		}
		100% {
			opacity: 1;
			transform: translateY(0) scale(1) rotateY(0);
		}
	}

	/* (Opacity only: the turning below has the transform.) */
	@keyframes rays-in {
		from {
			opacity: 0;
		}
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes flash {
		0% {
			transform: scale(0.3);
			opacity: 1;
		}
		100% {
			transform: scale(1.8);
			opacity: 0.35;
		}
	}

	@keyframes spark {
		0% {
			opacity: 1;
			transform: rotate(var(--angle)) translateX(20px);
		}
		100% {
			opacity: 0;
			transform: rotate(var(--angle)) translateX(var(--far));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.shade,
		.window,
		.crate,
		.crate svg,
		.crate .lid,
		.prize,
		.rays,
		.glow,
		.spark,
		.about {
			animation: none !important;
		}

		.spark {
			display: none;
		}
	}
</style>
