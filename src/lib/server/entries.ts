import { insertEntry, categoryIdForSlug } from './db/queries';
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
			.then(({ tags, cast }) => {
				setTags(id, tags);
				setCast(id, cast);
			})
			.catch(() => {});
	}

	return id;
}
