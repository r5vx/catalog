<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import NoAdsMark from '$lib/NoAdsMark.svelte';
	import BackBar from '$lib/BackBar.svelte';

	/**
	 * YouTube from the sidebar. Nothing opens until the button is pressed. In the desktop app it opens
	 * YouTube's normal website without ads (electron/youtubeWindow.cjs): in its own window, or, with
	 * the switch on, over all of Catalog's window (a pink circle beside YouTube's logo comes back).
	 * A phone opens YouTube's mobile website through the computer (src/lib/server/youtubePhone.ts),
	 * without ads. Anywhere else (another computer's browser) it can't.
	 */
	let { data } = $props();

	let inside = $state(untrack(() => data.inside));
	// Whether YouTube's own window is showing (inside Catalog it covers this page, so that's never shown).
	let windowOpen = $state(false);
	// Just asked to open: YouTube takes a moment to say it's open, so "closed" is ignored meanwhile.
	let openedAt = 0;

	async function open() {
		openedAt = Date.now();
		const resp = await fetch('/api/desktop/youtube', { method: 'POST' }).catch(() => null);
		if (resp?.ok && !inside) windowOpen = true;
	}

	async function setInside(on: boolean) {
		inside = on;
		await fetch('/api/desktop/youtube', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ inside: on })
		}).catch(() => {});
	}

	/*
	 * Phones: each person's phone uses their own YouTube account, signed in here (Google's page opens
	 * in the computer's own Edge; src/lib/server/youtubePhone.ts). The owner's is this computer's own.
	 */
	type Account = { id: number; name: string; signedIn: boolean; busy: 'signin' | 'signout' | null; last: string | null };
	let accounts = $state<Account[]>([]);

	async function account(profile: number, action: 'signin' | 'signout') {
		const resp = await fetch('/api/desktop/youtube', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ profile, action })
		}).catch(() => null);
		if (resp?.ok) accounts = (await resp.json()).accounts;
	}

	const lastWords: Record<string, string> = {
		'no-browser': 'Needs Microsoft Edge or Google Chrome',
		failed: "The sign-in window couldn't be opened"
	};

	// Whether YouTube's window is still open (closing it shows Open again here).
	async function check() {
		if (!data.canOpen || document.hidden) return;
		const resp = await fetch('/api/desktop/youtube').catch(() => null);
		if (!resp?.ok) return;
		const answer = await resp.json();
		if (answer.open) windowOpen = !inside;
		else if (Date.now() - openedAt > 3000) windowOpen = false;
		if (answer.accounts) accounts = answer.accounts;
	}

	/*
	 * The wall behind the button: what's on YouTube, as tilted columns of thumbnails drifting up and
	 * down at different speeds, fading out toward the middle (api/youtube/wall). Plain tiles until
	 * the pictures come (or when YouTube can't be reached).
	 */
	const COLUMNS = 7;
	// Enough that one copy of a column is taller than the page, so the loop's seam never shows.
	const PER_COLUMN = 10;
	let thumbs = $state<string[]>([]);
	const columns = $derived(
		Array.from({ length: COLUMNS }, (_, c) =>
			Array.from({ length: PER_COLUMN }, (_, r) => (thumbs.length ? thumbs[(c * PER_COLUMN + r) % thumbs.length] : null))
		)
	);

	let timer: ReturnType<typeof setInterval> | undefined;
	onMount(() => {
		check();
		timer = setInterval(check, 1000);
		fetch('/api/youtube/wall')
			.then((r) => (r.ok ? r.json() : null))
			.then((answer) => (thumbs = answer?.thumbs ?? []))
			.catch(() => {});
	});
	onDestroy(() => clearInterval(timer));
</script>

<svelte:head><title>YouTube · Catalog</title></svelte:head>

<BackBar />

<section class="stage">
	<div class="wall" aria-hidden="true">
		{#each columns as column, c (c)}
			<div class="column" style:--speed="{70 + ((c * 17) % 5) * 9}s" class:down={c % 2 === 1}>
				<!-- Twice over, so the drift loops without a seam. -->
				{#each [...column, ...column] as thumb, i (i)}
					<span class="tile">
						{#if thumb}<img src={thumb} alt="" onload={(e) => e.currentTarget.classList.add('in')} />{/if}
					</span>
				{/each}
			</div>
		{/each}
	</div>
	<div class="shade" aria-hidden="true"></div>

	<div class="middle">
		{#if data.canOpen}
			<button type="button" class="open" onclick={open}>
				<svg class="mark" viewBox="0 0 68 48" aria-hidden="true">
					<path
						d="M66.5 7.5a8.6 8.6 0 0 0-6-6C55.2 0 34 0 34 0S12.8 0 7.5 1.5a8.6 8.6 0 0 0-6 6C0 12.8 0 24 0 24s0 11.2 1.5 16.5a8.6 8.6 0 0 0 6 6C12.8 48 34 48 34 48s21.2 0 26.5-1.5a8.6 8.6 0 0 0 6-6C68 35.2 68 24 68 24s0-11.2-1.5-16.5z"
						fill="#ff0033"
					/>
					<path d="M27 34.3 45 24 27 13.7z" fill="#fff" />
				</svg>
				<span class="open-words">{windowOpen ? 'Show YouTube' : 'Open YouTube'}</span>
				<span class="no-ads"><NoAdsMark />No ads</span>
			</button>
			<p class="state">{windowOpen ? 'Open in its own window' : ' '}</p>

			<label class="switch">
				<input type="checkbox" role="switch" checked={inside} onchange={(e) => setInside(e.currentTarget.checked)} />
				<span class="track" aria-hidden="true"><span class="knob"></span></span>
				<span class="words">
					<strong>Open inside Catalog</strong>
					<span>Fills Catalog's window. The pink circle beside YouTube's logo comes back here.</span>
				</span>
			</label>

			{#if accounts.length}
				<section class="phones" aria-labelledby="phones-label">
					<h2 id="phones-label">Phones</h2>
					<ul>
						{#each accounts as person (person.id)}
							<li>
								<span class="who">{person.name}</span>
								<span class="how">
									{#if person.busy === 'signin'}Signing in…
									{:else if person.busy === 'signout'}Signing out…
									{:else if person.last && lastWords[person.last]}{lastWords[person.last]}
									{:else if person.signedIn}Signed in
									{:else}Not signed in{/if}
								</span>
								{#if person.signedIn}
									<button type="button" disabled={!!person.busy} onclick={() => account(person.id, 'signout')}>Sign out</button>
								{:else}
									<button type="button" disabled={!!person.busy} onclick={() => account(person.id, 'signin')}>Sign in</button>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{:else if data.phoneLink}
			<!-- A phone: YouTube's mobile website, through the computer, without ads. -->
			<a class="open" href={data.phoneLink}>
				<svg class="mark" viewBox="0 0 68 48" aria-hidden="true">
					<path
						d="M66.5 7.5a8.6 8.6 0 0 0-6-6C55.2 0 34 0 34 0S12.8 0 7.5 1.5a8.6 8.6 0 0 0-6 6C0 12.8 0 24 0 24s0 11.2 1.5 16.5a8.6 8.6 0 0 0 6 6C12.8 48 34 48 34 48s21.2 0 26.5-1.5a8.6 8.6 0 0 0 6-6C68 35.2 68 24 68 24s0-11.2-1.5-16.5z"
						fill="#ff0033"
					/>
					<path d="M27 34.3 45 24 27 13.7z" fill="#fff" />
				</svg>
				<span class="open-words">Open YouTube</span>
				<span class="no-ads"><NoAdsMark />No ads</span>
			</a>
			<p class="state">The pink circle beside YouTube's logo comes back here.</p>
		{:else}
			<svg class="mark still" viewBox="0 0 68 48" aria-hidden="true">
				<path
					d="M66.5 7.5a8.6 8.6 0 0 0-6-6C55.2 0 34 0 34 0S12.8 0 7.5 1.5a8.6 8.6 0 0 0-6 6C0 12.8 0 24 0 24s0 11.2 1.5 16.5a8.6 8.6 0 0 0 6 6C12.8 48 34 48 34 48s21.2 0 26.5-1.5a8.6 8.6 0 0 0 6-6C68 35.2 68 24 68 24s0-11.2-1.5-16.5z"
					fill="#ff0033"
				/>
				<path d="M27 34.3 45 24 27 13.7z" fill="#fff" />
			</svg>
			<span class="no-ads"><NoAdsMark />No ads</span>
			<p class="elsewhere">YouTube without ads opens in Catalog on the computer, on phones and on the Fire TV.</p>
		{/if}
	</div>
</section>

<style>
	/* The whole page: a wall of what's on YouTube, drifting slowly, behind one big button. */
	.stage {
		position: relative;
		display: grid;
		place-items: center;
		min-height: calc(100vh - 180px);
		border-radius: 18px;
		overflow: hidden;
		background: var(--surface);
		border: 1px solid var(--rule);
		isolation: isolate;
	}

	/* The wall: columns of thumbnails, tilted, drifting up and down at their own speeds. */
	.wall {
		position: absolute;
		inset: -30% -20%;
		z-index: -2;
		display: flex;
		gap: 18px;
		justify-content: center;
		/*
		 * Each column only as tall as its tiles. Stretched to the wall's height (the default), the
		 * drift's "-50%" was half the wall, not half the tiles, so every loop ended with a jump.
		 */
		align-items: flex-start;
		transform: rotate(-12deg);
	}

	.column {
		flex: 0 0 clamp(150px, 16vw, 240px);
		display: flex;
		flex-direction: column;
		gap: 18px;
		animation: drift var(--speed, 80s) linear infinite;
	}

	.column.down {
		animation-direction: reverse;
		margin-top: -60px;
	}

	@keyframes drift {
		from {
			transform: translateY(0);
		}
		to {
			/* Half its length (the second copy), plus half a gap: lands exactly where it began. */
			transform: translateY(calc(-50% - 9px));
		}
	}

	.tile {
		flex: none;
		aspect-ratio: 16 / 9;
		border-radius: 12px;
		overflow: hidden;
		background: var(--surface-2);
		box-shadow: 0 10px 30px -14px rgb(0 0 0 / 60%);
	}

	.tile img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: 0;
		filter: saturate(0.85) brightness(0.9);
		transition: opacity 0.8s ease;
	}

	.tile img:global(.in) {
		opacity: 1;
	}

	/* Clear in the middle where the button is, the thumbnails showing more toward the edges. */
	.shade {
		position: absolute;
		inset: 0;
		z-index: -1;
		background:
			radial-gradient(ellipse 44% 50% at 50% 50%, var(--surface) 0%, color-mix(in srgb, var(--surface) 94%, transparent) 50%, color-mix(in srgb, var(--surface) 45%, transparent) 100%),
			linear-gradient(180deg, var(--surface) 0%, transparent 18%, transparent 82%, var(--surface) 100%),
			radial-gradient(circle at 50% 46%, rgb(255 0 51 / 16%), transparent 55%);
	}

	/* Whose YouTube each person's phone uses. */
	.phones {
		width: min(100%, 26rem);
		margin-top: 10px;
		padding: 16px 18px;
		border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
		border-radius: 18px;
		background: color-mix(in srgb, var(--surface) 72%, transparent);
		backdrop-filter: blur(12px);
		text-align: left;
	}

	.phones h2 {
		margin: 0 0 8px;
		font-size: 0.85rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.phones ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.phones li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 0;
	}

	.phones li + li {
		border-top: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
	}

	.who {
		font-weight: 600;
	}

	.how {
		flex: 1;
		color: var(--ink-soft);
		font-size: 0.9rem;
	}

	.phones button {
		padding: 6px 14px;
		border: 1px solid color-mix(in srgb, var(--ink) 18%, transparent);
		border-radius: 999px;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.phones button:hover:not(:disabled) {
		border-color: var(--accent);
	}

	.phones button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.middle {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 18px;
		padding: 40px 20px;
		text-align: center;
	}

	.open {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 18px;
		padding: 38px 64px 30px;
		border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
		border-radius: 28px;
		background: color-mix(in srgb, var(--surface) 72%, transparent);
		backdrop-filter: blur(12px);
		color: var(--ink);
		font: inherit;
		text-decoration: none;
		cursor: pointer;
		box-shadow: 0 18px 50px -20px rgb(255 0 51 / 55%);
		transition:
			transform 0.18s ease,
			box-shadow 0.18s ease;
	}

	.open:hover {
		transform: translateY(-3px) scale(1.02);
		box-shadow: 0 26px 60px -18px rgb(255 0 51 / 70%);
	}

	.open:active {
		transform: scale(0.98);
	}

	.open:focus-visible {
		outline: 3px solid var(--accent);
		outline-offset: 4px;
	}

	.mark {
		width: 132px;
		height: auto;
		filter: drop-shadow(0 8px 18px rgb(255 0 51 / 35%));
		transition: transform 0.18s ease;
	}

	.open:hover .mark {
		transform: scale(1.06);
	}

	.mark.still {
		width: 96px;
	}

	.open-words {
		font-family: var(--display);
		font-size: 1.9rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	/* "No ads": what makes this YouTube different, in bold on the button. */
	.no-ads {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin-top: -4px;
		padding: 6px 14px 6px 10px;
		border-radius: 999px;
		background: #ff0033;
		color: #fff;
		font-size: 0.95rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		box-shadow: 0 6px 18px -6px rgb(255 0 51 / 70%);
	}

	.no-ads :global(svg) {
		width: 26px;
		height: auto;
	}

	.state {
		margin: -6px 0 0;
		min-height: 1.4em;
		color: var(--ink-soft);
		font-size: 0.95rem;
		/* (Kept a line tall when empty; wraps on a phone.) */
		white-space: pre-wrap;
		text-align: center;
		padding: 0 16px;
	}

	.elsewhere {
		margin: 0;
		max-width: 420px;
		color: var(--ink-soft);
	}

	/* The switch: a track and knob over a real checkbox (keyboard and screen readers use that). */
	.switch {
		position: relative;
		display: flex;
		align-items: center;
		gap: 14px;
		max-width: 440px;
		padding: 14px 18px;
		border-radius: 16px;
		background: color-mix(in srgb, var(--surface) 70%, transparent);
		backdrop-filter: blur(12px);
		border: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
		text-align: left;
		cursor: pointer;
	}

	.switch input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}

	.track {
		flex: none;
		position: relative;
		width: 44px;
		height: 26px;
		border-radius: 13px;
		background: var(--rule-firm);
		transition: background 0.15s ease;
	}

	.knob {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 3px rgb(0 0 0 / 30%);
		transition: transform 0.15s ease;
	}

	.switch input:checked + .track {
		background: var(--accent);
	}

	.switch input:checked + .track .knob {
		transform: translateX(18px);
	}

	.switch input:focus-visible + .track {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.words {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.words span {
		color: var(--ink-soft);
		font-size: 0.85rem;
		line-height: 1.4;
	}

	@media (max-width: 520px) {
		.open {
			padding: 30px 36px 24px;
		}

		.mark {
			width: 104px;
		}

		.open-words {
			font-size: 1.5rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.column {
			animation: none;
		}
	}
</style>
