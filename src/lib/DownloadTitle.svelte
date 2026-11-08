<script lang="ts">
	/**
	 * Download from a title's page, without opening the player (owner, 2026-11-06): a film, or any
	 * of a show's seasons, the whole show at once. The computer picks each copy and downloads them
	 * one after another (src/lib/server/titleDownloads.ts); they're listed in Downloads.
	 */
	let { title, type, year = null, poster = null }: { title: string; type: 'tv' | 'movie'; year?: number | string | null; poster?: string | null } = $props();

	type Episode = { season: number; episode: number; name: string | null; can: boolean; already: boolean };
	type Answer =
		| { found: false }
		| { found: true; type: 'movie'; title: string; can: boolean; already: boolean }
		| { found: true; type: 'tv'; title: string; episodes: Episode[] };

	let open = $state(false);
	let answer = $state<Answer | null>(null);
	let failed = $state(false);
	let picked = $state<number[]>([]);
	let height = $state(0);
	let captions = $state(true);
	let busy = $state(false);
	let done = $state<string | null>(null);

	async function show() {
		open = true;
		done = null;
		if (answer) return;
		failed = false;
		const params = new URLSearchParams({ title, type });
		if (year) params.set('year', String(year));
		const got = await fetch(`/api/downloads/title?${params}`)
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		if (!got) failed = true;
		answer = got;
		// A show of one season starts with it picked; with more, nothing is (a whole show by accident is a lot).
		if (got?.type === 'tv') {
			const ready = seasonsOf(got.episodes).filter((s) => s.fresh > 0);
			picked = ready.length === 1 ? [ready[0].season] : [];
		}
	}

	function close() {
		open = false;
	}

	function seasonsOf(episodes: Episode[]) {
		const bySeason = new Map<number, Episode[]>();
		for (const ep of episodes) bySeason.set(ep.season, [...(bySeason.get(ep.season) ?? []), ep]);
		return [...bySeason].map(([season, eps]) => ({
			season,
			count: eps.length,
			fresh: eps.filter((e) => e.can && !e.already).length,
			already: eps.filter((e) => e.already).length,
			showboxOnly: eps.filter((e) => !e.can).length
		}));
	}

	const seasons = $derived(answer?.found && answer.type === 'tv' ? seasonsOf(answer.episodes) : []);
	const toGet = $derived(
		answer?.found && answer.type === 'tv'
			? answer.episodes.filter((e) => picked.includes(e.season) && e.can && !e.already)
			: []
	);
	const allPicked = $derived(seasons.length > 0 && seasons.filter((s) => s.fresh > 0).every((s) => picked.includes(s.season)));

	function toggle(season: number) {
		picked = picked.includes(season) ? picked.filter((s) => s !== season) : [...picked, season];
	}

	function toggleAll() {
		picked = allPicked ? [] : seasons.filter((s) => s.fresh > 0).map((s) => s.season);
	}

	async function start() {
		if (!answer?.found || busy) return;
		busy = true;
		const body = {
			title: answer.title,
			type,
			year: year ? String(year) : '',
			poster,
			height,
			captions,
			episodes: answer.type === 'tv' ? toGet.map((e) => `${e.season}:${e.episode}`) : null
		};
		const result = await fetch('/api/downloads/title', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		busy = false;
		if (!result) {
			done = "Couldn't start the download. Try again in a moment.";
			return;
		}
		const what = answer.type === 'tv' ? (result.added === 1 ? '1 episode' : `${result.added} episodes`) : 'It';
		done = result.added ? `${what} added to Downloads.` : 'Already in Downloads.';
		// Marked as in Downloads now, for the next look.
		if (answer.type === 'tv') {
			const added = new Set(body.episodes ?? []);
			answer = { ...answer, episodes: answer.episodes.map((e) => (added.has(`${e.season}:${e.episode}`) ? { ...e, already: true } : e)) };
			picked = [];
		} else answer = { ...answer, already: true };
	}

	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
</script>

<button type="button" class="btn download-btn" onclick={show}>
	<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" /></svg>
	Download
</button>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="backdrop" onclick={close}></div>
	<div class="box" role="dialog" aria-modal="true" aria-labelledby="download-title">
		<h2 id="download-title">Download {title}</h2>

		{#if !answer && !failed}
			<p class="muted">Finding copies…</p>
		{:else if failed || !answer?.found}
			<p class="muted">Nothing to download right now.</p>
		{:else if answer.type === 'movie' && !answer.can}
			<p class="muted">Only Showbox has it, and Showbox's copies aren't downloaded (they'd use up Febbox's daily allowance).</p>
		{:else if answer.type === 'movie' && answer.already && !done}
			<p class="muted">Already in Downloads.</p>
		{:else if answer.type === 'tv'}
			<div class="seasons">
				{#if seasons.length > 1}
					<label class="season all">
						<input type="checkbox" checked={allPicked} onchange={toggleAll} />
						<span><strong>Whole show</strong></span>
					</label>
				{/if}
				{#each seasons as s (s.season)}
					<label class="season" class:none={s.fresh === 0}>
						<input type="checkbox" checked={picked.includes(s.season)} disabled={s.fresh === 0} onchange={() => toggle(s.season)} />
						<span>
							<strong>Season {s.season}</strong>
							<span class="faint">
								{plural(s.count, 'episode')}{s.already ? ` · ${s.already} in Downloads` : ''}{s.showboxOnly ? ` · ${s.showboxOnly} only on Showbox` : ''}
							</span>
						</span>
					</label>
				{/each}
			</div>
		{/if}

		{#if answer?.found && (answer.type === 'tv' || (answer.can && !answer.already))}
			<div class="choices">
				<div class="quality" role="radiogroup" aria-label="Quality">
					<button type="button" role="radio" aria-checked={height === 0} class:on={height === 0} onclick={() => (height = 0)}>Best quality</button>
					<button type="button" role="radio" aria-checked={height === 720} class:on={height === 720} title="720p where the copy has it" onclick={() => (height = 720)}>Smaller</button>
				</div>
				<label class="captions"><input type="checkbox" bind:checked={captions} /> English captions</label>
			</div>
		{/if}

		{#if done}<p class="done">{done} <a href="/downloads">See Downloads</a></p>{/if}

		<div class="buttons">
			<button type="button" class="btn" onclick={close}>{done ? 'Close' : 'Cancel'}</button>
			{#if answer?.found && answer.type === 'tv'}
				<button type="button" class="btn btn-primary" disabled={busy || toGet.length === 0} onclick={start}>
					{busy ? 'Adding…' : toGet.length ? `Download ${plural(toGet.length, 'episode')}` : 'Download'}
				</button>
			{:else if answer?.found && answer.type === 'movie' && answer.can && !answer.already}
				<button type="button" class="btn btn-primary" disabled={busy} onclick={start}>{busy ? 'Adding…' : 'Download'}</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.download-btn svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: rgb(0 0 0 / 50%);
		animation: fade 0.12s ease;
	}

	.box {
		position: fixed;
		z-index: 1001;
		left: 50%;
		top: 12vh;
		translate: -50% 0;
		width: min(460px, calc(100vw - 32px));
		max-height: 76vh;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 20px 22px 18px;
		background: var(--surface);
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius);
		box-shadow: var(--shadow), 0 20px 50px -20px rgb(0 0 0 / 60%);
		animation: rise 0.14s ease;
	}

	h2 {
		font-size: 1.15rem;
		margin: 0;
		overflow-wrap: anywhere;
	}

	p {
		margin: 0;
		font-size: 0.9rem;
	}

	.seasons {
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-y: auto;
		min-height: 0;
		margin: 0 -6px;
	}

	.season {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 6px;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.season:hover {
		background: var(--surface-2);
	}

	.season.none {
		opacity: 0.55;
		cursor: default;
	}

	.season.all {
		border-bottom: 1px solid var(--rule);
		border-radius: 0;
		margin-bottom: 4px;
		padding-bottom: 9px;
	}

	.season input,
	.captions input {
		width: auto;
		margin: 0;
	}

	.season > span {
		display: flex;
		flex-direction: column;
	}

	.season .faint {
		font-size: 0.82rem;
	}

	.choices {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.quality {
		display: inline-flex;
		padding: 3px;
		border-radius: 999px;
		background: var(--sunk);
	}

	.quality button {
		padding: 5px 12px;
		border: 0;
		border-radius: 999px;
		background: none;
		font-size: 0.85rem;
		cursor: pointer;
		color: var(--ink-soft);
	}

	.quality button.on {
		background: var(--surface);
		color: var(--ink);
		box-shadow: var(--shadow);
	}

	.captions {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.done a {
		margin-left: 4px;
	}

	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	@keyframes fade {
		from {
			opacity: 0;
		}
	}

	@keyframes rise {
		from {
			opacity: 0;
			translate: -50% 8px;
		}
	}
</style>
