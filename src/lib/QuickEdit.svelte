<script lang="ts">
	/**
	 * The parts of a title you change most, right on its page, saved the moment they change: your
	 * rating, the status, favourite, how many times you've watched it, and how far into a series
	 * you are. (They used to be in the Edit form: open it, scroll, change, Save.)
	 *
	 * `onsaved` hears what changed, so the page around it can show it too.
	 */
	import { onMount, untrack } from 'svelte';
	import StarRating from '$lib/StarRating.svelte';
	import StatusPicker from '$lib/StatusPicker.svelte';
	import ProgressPicker from '$lib/ProgressPicker.svelte';

	type Fields = {
		rating?: number | null;
		status?: string;
		favorite?: boolean;
		rewatches?: number;
		lastSeason?: number | null;
		lastEpisode?: number | null;
		finishedOn?: string | null;
	};
	type Props = {
		entry: { id: number; rating: number | null; status: string; favorite: boolean; rewatches: number; lastSeason: number | null; lastEpisode: number | null };
		/** A series: how far into it shows. */
		series: boolean;
		onsaved?: (fields: Fields) => void;
	};

	let { entry, series, onsaved }: Props = $props();

	// Seeded once: a refresh of the page under it doesn't undo a click.
	const start = untrack(() => entry);
	let rating = $state(start.rating);
	let status = $state(start.status);
	let favorite = $state(Boolean(start.favorite));
	let rewatches = $state(start.rewatches ?? 0);
	let lastSeason = $state(start.lastSeason);
	let lastEpisode = $state(start.lastEpisode);
	let seasons = $state<{ season: number; episodes: number }[] | null>(null);
	/** Asked yet (until then, no boxes that turn into dropdowns a second later). */
	let seasonsAsked = $state(false);

	/** "Saved" or "Couldn't save", for a moment. */
	let said = $state('');
	let sayTimer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		if (!series) return;
		fetch(`/api/entries/seasons?id=${start.id}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((found) => (seasons = found))
			.catch(() => {})
			.finally(() => (seasonsAsked = true));
	});

	async function save(fields: Fields) {
		clearTimeout(sayTimer);
		try {
			const resp = await fetch('/api/entries', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: start.id, action: 'set', fields })
			});
			if (!resp.ok) throw new Error();
			// (Completed dates it, so the date is passed on too.)
			const { finishedOn } = (await resp.json()) as { finishedOn?: string | null };
			said = 'Saved';
			onsaved?.({ ...fields, finishedOn: finishedOn ?? null });
		} catch {
			said = "Couldn't save";
		}
		sayTimer = setTimeout(() => (said = ''), 1800);
	}
</script>

<div class="quick">
	<div class="line">
		<StarRating bind:value={rating} onchange={(value) => save({ rating: value })} />
		<button
			type="button"
			class="fav"
			class:on={favorite}
			aria-pressed={favorite}
			title={favorite ? 'Favourite' : 'Mark as a favourite'}
			onclick={() => {
				favorite = !favorite;
				save({ favorite });
			}}
		>
			<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
				<path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.1 4.3 2.4.7-1.3 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z" />
			</svg>
		</button>
		{#if said}<span class="said" class:bad={said !== 'Saved'} role="status">{said}</span>{/if}
	</div>

	<StatusPicker bind:value={status} onchange={(value) => save({ status: value })} />

	<div class="line">
		{#if series && seasonsAsked}
			<ProgressPicker
				{seasons}
				bind:season={lastSeason}
				bind:episode={lastEpisode}
				onchange={(season, episode) => save({ lastSeason: season, lastEpisode: episode })}
			/>
		{/if}
		<div class="times">
			<span>Watched</span>
			<button
				type="button"
				class="step"
				aria-label="One time fewer"
				disabled={rewatches <= 0}
				onclick={() => {
					rewatches -= 1;
					save({ rewatches });
				}}>−</button
			>
			<span class="count tabular">{rewatches + 1}×</span>
			<button
				type="button"
				class="step"
				aria-label="One time more"
				onclick={() => {
					rewatches += 1;
					save({ rewatches });
				}}>+</button
			>
		</div>
	</div>
</div>

<style>
	.quick {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 14px 16px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		max-width: 560px;
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 18px;
	}

	.fav {
		display: flex;
		padding: 4px;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		cursor: pointer;
	}

	.fav path {
		fill: none;
		stroke: var(--ink-faint);
		stroke-width: 1.6;
	}

	.fav.on path {
		fill: var(--accent);
		stroke: var(--accent);
	}

	.said {
		font-size: 0.8rem;
		color: var(--good);
	}

	.said.bad {
		color: var(--accent);
	}

	.times {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.86rem;
		color: var(--ink-soft);
	}

	.step {
		width: 26px;
		height: 26px;
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink);
		font: inherit;
		line-height: 1;
		cursor: pointer;
	}

	.step:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.count {
		min-width: 26px;
		text-align: center;
		color: var(--ink);
	}
</style>
