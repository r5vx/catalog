<script lang="ts">
	import { untrack } from 'svelte';
	import { STATUSES } from '$lib/constants';
	import type { Category, Entry } from '$lib/server/db/types';

	type Props = {
		categories: Category[];
		entry?: Partial<Entry>;
		submitLabel?: string;
	};

	let { categories, entry = {}, submitLabel = 'Save' }: Props = $props();

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
	let categoryId = $state(
		String(start.categoryId ?? untrack(() => categories)[0]?.id ?? '')
	);
	let year = $state(start.year != null ? String(start.year) : '');
	let status = $state(start.status ?? 'completed');
	let rating = $state(start.rating != null ? String(start.rating) : '');
	let rewatches = $state(String(start.rewatches ?? 0));
	let favorite = $state(Boolean(start.favorite));
	let lastSeason = $state(start.lastSeason != null ? String(start.lastSeason) : '');
	let lastEpisode = $state(start.lastEpisode != null ? String(start.lastEpisode) : '');
	let startedOn = $state(start.startedOn ?? '');
	let finishedOn = $state(start.finishedOn ?? '');
	let notes = $state(start.notes ?? '');
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
			<label for="posterUrl">Poster URL</label>
			<input
				type="text"
				id="posterUrl"
				name="posterUrl"
				bind:value={posterUrl}
				placeholder="Paste an image link"
			/>
			<p class="hint faint">Filled in automatically by search.</p>
		</div>
	</aside>

	<div class="fields">
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
				<input
					type="number"
					id="year"
					name="year"
					bind:value={year}
					min="1870"
					max="2100"
					placeholder="—"
				/>
			</div>
		</div>

		<div class="row">
			<div class="field">
				<label for="status">Status</label>
				<select id="status" name="status" bind:value={status}>
					{#each STATUSES as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</div>

			<div class="field">
				<label for="rating">Rating (0&ndash;10)</label>
				<input
					type="number"
					id="rating"
					name="rating"
					bind:value={rating}
					min="0"
					max="10"
					step="0.5"
					placeholder="Unrated"
				/>
			</div>
		</div>

		<div class="row">
			<div class="field">
				<label for="rewatches">Times rewatched</label>
				<input
					type="number"
					id="rewatches"
					name="rewatches"
					bind:value={rewatches}
					min="0"
					max="999"
				/>
			</div>

			<div class="field check">
				<label for="favorite">Favourite</label>
				<label class="checkbox">
					<input type="checkbox" id="favorite" name="favorite" value="on" bind:checked={favorite} />
					<span>Mark as a favourite</span>
				</label>
			</div>
		</div>

		<div class="row">
			<div class="field">
				<label for="lastSeason">Season reached</label>
				<input
					type="number"
					id="lastSeason"
					name="lastSeason"
					bind:value={lastSeason}
					min="0"
					max="999"
					placeholder="—"
				/>
			</div>

			<div class="field">
				<label for="lastEpisode">Episode reached</label>
				<input
					type="number"
					id="lastEpisode"
					name="lastEpisode"
					bind:value={lastEpisode}
					min="0"
					max="9999"
					placeholder="—"
				/>
			</div>
		</div>

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
			<textarea id="notes" name="notes" bind:value={notes} placeholder="What did you think of it?"
			></textarea>
		</div>

		<div class="actions">
			<button type="submit" class="btn btn-primary">{submitLabel}</button>
			<a href="/" class="btn">Cancel</a>
		</div>
	</div>
</div>

<style>
	.layout {
		display: grid;
		grid-template-columns: 220px 1fr;
		gap: 32px;
		align-items: start;
	}

	@media (max-width: 680px) {
		.layout {
			grid-template-columns: 1fr;
			gap: 24px;
		}
		.poster-side {
			max-width: 220px;
		}
	}

	.poster-side {
		display: flex;
		flex-direction: column;
		gap: 14px;
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
		gap: 18px;
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
		text-transform: none;
		letter-spacing: 0;
		font-weight: 400;
	}

	.checkbox input {
		width: 16px;
		height: 16px;
		accent-color: var(--accent);
		cursor: pointer;
	}

	.check :global(label:first-child) {
		margin-bottom: -2px;
	}

	.hint {
		font-size: 0.75rem;
		margin: 0;
	}

	.actions {
		display: flex;
		gap: 10px;
		padding-top: 6px;
	}
</style>
