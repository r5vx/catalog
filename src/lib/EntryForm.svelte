<script lang="ts">
	/**
	 * A title's details, as a form.
	 *
	 * Two ways to use it:
	 * - `full` (adding a title by hand): everything, rating and status included.
	 * - `details` (under a title's page): only what the quick controls at the top of the page
	 *   don't cover. Name, category, year, dates, notes and poster are saved with its button;
	 *   rating, status and the rest save themselves up there.
	 */
	import { untrack } from 'svelte';
	import StarRating from '$lib/StarRating.svelte';
	import StatusPicker from '$lib/StatusPicker.svelte';
	import ProgressPicker from '$lib/ProgressPicker.svelte';
	import type { Category, Entry } from '$lib/server/db/types';

	type Props = {
		categories: Category[];
		entry?: Partial<Entry>;
		submitLabel?: string;
		mode?: 'full' | 'details';
		/** Where Cancel goes. */
		cancelHref?: string;
	};

	let { categories, entry = {}, submitLabel = 'Save', mode = 'full', cancelHref = '/' }: Props = $props();

	/**
	 * Every field keeps its own value, seeded once from the entry.
	 *
	 * They used to read straight from the prop (`value={entry.title}`), which
	 * meant any refresh of the page data reset every box back to what was
	 * stored — mid-sentence. From the outside that looks exactly like the text
	 * boxes having stopped working. Owning the values makes typing safe no
	 * matter what reloads underneath.
	 */
	const start = untrack(() => entry);

	let posterUrl = $state(start.posterUrl ?? '');
	let title = $state(start.title ?? '');
	let categoryId = $state(String(start.categoryId ?? untrack(() => categories)[0]?.id ?? ''));
	let year = $state(start.year != null ? String(start.year) : '');
	let status = $state(start.status ?? 'completed');
	let rating = $state<number | null>(start.rating ?? null);
	let rewatches = $state(String(start.rewatches ?? 0));
	let favorite = $state(Boolean(start.favorite));
	let lastSeason = $state<number | null>(start.lastSeason ?? null);
	let lastEpisode = $state<number | null>(start.lastEpisode ?? null);
	let startedOn = $state(start.startedOn ?? '');
	let finishedOn = $state(start.finishedOn ?? '');
	let notes = $state(start.notes ?? '');

	const isMovie = $derived(categories.find((c) => String(c.id) === categoryId)?.slug === 'movies');
</script>

<div class="layout">
	<aside class="poster-side">
		<div class="preview">
			{#if posterUrl}
				<img src={posterUrl} alt="Poster preview" />
			{:else}
				<span class="placeholder">No poster</span>
			{/if}
		</div>
		<div class="field">
			<label for="posterUrl">Poster link</label>
			<input type="text" id="posterUrl" name="posterUrl" bind:value={posterUrl} placeholder="Paste an image link" />
		</div>
	</aside>

	<div class="fields">
		<section class="group">
			<div class="field">
				<label for="title">Title</label>
				<input type="text" id="title" name="title" bind:value={title} required autocomplete="off" />
			</div>
			<div class="row">
				<div class="field">
					<label for="categoryId">Category</label>
					<select id="categoryId" name="categoryId" bind:value={categoryId}>
						{#each categories as category (category.id)}
							<option value={String(category.id)}>{category.emoji} {category.name}</option>
						{/each}
					</select>
				</div>
				<div class="field">
					<label for="year">Year</label>
					<input type="number" id="year" name="year" bind:value={year} min="1870" max="2100" placeholder="—" />
				</div>
			</div>
		</section>

		{#if mode === 'full'}
			<section class="group">
				<div class="field">
					<span class="label">Your rating</span>
					<StarRating bind:value={rating} name="rating" />
				</div>
				<div class="field">
					<span class="label">Status</span>
					<StatusPicker bind:value={status} name="status" />
				</div>
				<div class="row">
					<div class="field">
						<label for="rewatches">Times rewatched</label>
						<input type="number" id="rewatches" name="rewatches" bind:value={rewatches} min="0" max="999" />
					</div>
					<div class="field">
						<span class="label">Favourite</span>
						<label class="checkbox">
							<input type="checkbox" name="favorite" value="on" bind:checked={favorite} />
							<span>Mark as a favourite</span>
						</label>
					</div>
				</div>
				{#if !isMovie}
					<div class="field">
						<span class="label">Reached</span>
						<ProgressPicker seasons={null} bind:season={lastSeason} bind:episode={lastEpisode} seasonName="lastSeason" episodeName="lastEpisode" />
					</div>
				{/if}
			</section>
		{/if}

		<section class="group">
			<div class="row">
				<div class="field">
					<label for="startedOn">Started</label>
					<input type="date" id="startedOn" name="startedOn" bind:value={startedOn} />
				</div>
				<div class="field">
					<label for="finishedOn">Finished</label>
					<input type="date" id="finishedOn" name="finishedOn" bind:value={finishedOn} />
				</div>
			</div>
			<div class="field">
				<label for="notes">Notes and review</label>
				<textarea id="notes" name="notes" bind:value={notes} placeholder="What did you think of it?"></textarea>
			</div>
		</section>

		<div class="actions">
			<button type="submit" class="btn btn-primary">{submitLabel}</button>
			{#if mode === 'full'}<a href={cancelHref} class="btn">Cancel</a>{/if}
		</div>
	</div>
</div>

<style>
	.layout {
		display: grid;
		grid-template-columns: 180px 1fr;
		gap: 28px;
		align-items: start;
	}

	@media (max-width: 680px) {
		.layout {
			grid-template-columns: 1fr;
			gap: 22px;
		}
		.poster-side {
			max-width: 200px;
		}
	}

	.poster-side {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.preview {
		aspect-ratio: 2 / 3;
		max-width: 100%;
		background: var(--surface-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		overflow: hidden;
		display: grid;
		place-items: center;
	}

	.preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.placeholder {
		font-size: 0.8rem;
		color: var(--ink-faint);
	}

	.fields {
		display: flex;
		flex-direction: column;
		gap: 22px;
	}

	/* Each group of fields sits in its own block, a line between them. */
	.group {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding-bottom: 22px;
		border-bottom: 1px solid var(--rule);
	}

	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}

	@media (max-width: 460px) {
		.row {
			grid-template-columns: 1fr;
		}
	}

	.checkbox {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 0;
		font-size: 0.92rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.checkbox input {
		width: 16px;
		height: 16px;
		accent-color: var(--accent);
		cursor: pointer;
	}

	textarea {
		min-height: 110px;
	}

	.actions {
		display: flex;
		gap: 10px;
	}
</style>
