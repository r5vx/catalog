import { insertEntry, categoryIdForSlug, saveFacts, entryIdForSource } from './db/queries';
import { setTags } from './db/tags';
import { setCast } from './db/people';
import { fetchDetails } from './metadata/details';
import type { SearchResult } from './metadata';

export const today = () => new Date().toISOString().slice(0, 10);

type Overrides = {
	categoryId?: number | null;
	status?: string;
	/** Bulk imports of old watches leave this off - you do not remember the date. */
	markWatchedToday?: boolean;
	/** Where you left off, e.g. from "(S1E23)" in an imported list. */
	lastSeason?: number | null;
	lastEpisode?: number | null;
};

/**
 * Turn a search result into a library entry. Everything the provider knows is
 * filled in; everything only you know (rating, notes) stays empty until you
 * feel like adding it.
 */
export function createFromResult(result: SearchResult, overrides: Overrides = {}): number {
	const categoryId = overrides.categoryId ?? categoryIdForSlug(result.categorySlug);

	const id = insertEntry({
		categoryId,
		title: result.title,
		year: result.year,
		posterUrl: result.posterUrl,
		overview: result.overview,
		source: result.source,
		sourceId: result.sourceId,
		episodesTotal: result.episodesTotal,
		runtimeMinutes: result.runtimeMinutes,
		externalRating: result.externalRating,
		externalVotes: result.externalVotes,
		lastSeason: overrides.lastSeason ?? null,
		lastEpisode: overrides.lastEpisode ?? null,
		// Always Completed. A season/episode marker often just records where a
		// finished show ended, not that you're partway through — so it's yours
		// to change, not ours to guess.
		status: overrides.status ?? 'completed',
		finishedOn: overrides.markWatchedToday ? today() : null
	});

	// Tags and cast, fetched in the background so adding stays instant.
	if (result.sourceId) {
		fetchDetails(result.source, result.sourceId)
			.then((details) => {
				setTags(id, details.tags);
				setCast(id, details.cast);
				// Runtime only comes back from the detail endpoint, never search.
				saveFacts(id, {
					runtimeMinutes: details.runtimeMinutes,
					episodesTotal: details.episodesTotal,
					// A title in the reply means the lookup worked, even if it
					// carried no runtime. A failed one must not count as asked.
					checked: Boolean(details.title)
				});
			})
			.catch(() => {});
	}

	return id;
}

/**
 * Add something by its provider id alone.
 *
 * Used wherever you're looking at a title rather than a search result — the
 * browse page, someone else's shared list — so those can put it straight in
 * your library without sending you off to search for what's already in front
 * of you.
 *
 * Adding the same thing twice returns the entry you already have rather than
 * making a duplicate.
 */
export async function addFromSource(
	source: string,
	sourceId: string,
	status = 'planned'
): Promise<{ id: number; already: boolean } | null> {
	if (source !== 'tmdb' && source !== 'anilist') return null;

	const existing = entryIdForSource(source, sourceId);
	if (existing) return { id: existing, already: true };

	const details = await fetchDetails(source, sourceId);
	if (!details.title) return null;

	const id = createFromResult(
		{
			key: `${source}:${sourceId}`,
			source,
			sourceId,
			title: details.title,
			altTitle: details.altTitle,
			year: details.year,
			posterUrl: details.posterUrl,
			overview: details.overview,
			categorySlug: details.categorySlug,
			confident: true,
			kind: details.kind,
			episodesTotal: details.episodesTotal,
			runtimeMinutes: details.runtimeMinutes,
			externalRating: details.externalRating,
			externalVotes: details.externalVotes,
			popularity: 0
		},
		{
			categoryId: categoryIdForSlug(details.categorySlug),
			status,
			// Something you've just found goes on the list, not into history —
			// unless you say you've already seen it.
			markWatchedToday: status === 'completed'
		}
	);

	return { id, already: false };
}
