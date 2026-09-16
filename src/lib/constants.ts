/** Watch states. Change the labels here and they change everywhere in the app. */
export const STATUSES = [
	{ value: 'watching', label: 'Watching' },
	{ value: 'completed', label: 'Completed' },
	{ value: 'planned', label: 'Want to watch' },
	{ value: 'paused', label: 'On hold' },
	{ value: 'dropped', label: 'Dropped' }
] as const;

export type StatusValue = (typeof STATUSES)[number]['value'];

export const statusLabel = (value: string) =>
	STATUSES.find((s) => s.value === value)?.label ?? value;

/**
 * How the library can be ordered. `column` maps to a real database column, and
 * `group` is only there to keep the picker readable — there are enough of these
 * now that one flat list was a scroll.
 */
export const SORTS = [
	{ value: 'recent', label: 'Recently added', column: 'created_at', dir: 'desc', group: 'yours' },
	{ value: 'updated', label: 'Recently updated', column: 'updated_at', dir: 'desc', group: 'yours' },
	{ value: 'rating', label: 'My rating', column: 'rating', dir: 'desc', group: 'yours' },
	{ value: 'rewatches', label: 'Most rewatched', column: 'rewatches', dir: 'desc', group: 'yours' },
	{ value: 'finished', label: 'Recently finished', column: 'finished_on', dir: 'desc', group: 'yours' },

	{ value: 'public', label: 'TMDB / AniList', column: 'external_rating', dir: 'desc', group: 'scores' },
	{ value: 'imdb', label: 'IMDb rating', column: 'imdb_rating', dir: 'desc', group: 'scores' },
	{ value: 'rt', label: 'Rotten Tomatoes', column: 'rt_score', dir: 'desc', group: 'scores' },
	{ value: 'metacritic', label: 'Metacritic', column: 'metascore', dir: 'desc', group: 'scores' },
	{ value: 'votes', label: 'Most voted on', column: 'external_votes', dir: 'desc', group: 'scores' },

	{ value: 'title', label: 'Title (A–Z)', column: 'title', dir: 'asc', group: 'title' },
	{ value: 'year', label: 'Newest release', column: 'year', dir: 'desc', group: 'title' },
	{ value: 'oldest', label: 'Oldest release', column: 'year', dir: 'asc', group: 'title' },
	{ value: 'box', label: 'Box office', column: 'box_office', dir: 'desc', group: 'title' },
	{ value: 'runtime', label: 'Longest', column: 'runtime_minutes', dir: 'desc', group: 'title' }
] as const;

export type SortValue = (typeof SORTS)[number]['value'];

/** Headings for the sort picker, in the order they appear. */
export const SORT_GROUPS = [
	{ key: 'yours', label: 'Yours' },
	{ key: 'scores', label: 'Scores' },
	{ key: 'title', label: 'The title itself' }
] as const;

export const sortLabel = (value: string) =>
	SORTS.find((one) => one.value === value)?.label ?? 'Sort';

/* ------------------------------------------------------- showing the sort */

/** Enough of a card to describe the value it was sorted on. */
type Sortable = {
	runtimeMinutes?: number | null;
	boxOffice?: number | null;
	imdbRating?: number | null;
	rtScore?: number | null;
	metascore?: number | null;
	externalRating?: number | null;
	externalVotes?: number | null;
	createdAt?: string | null;
	updatedAt?: string | null;
	finishedOn?: string | null;
};

const shortDate = (value: string | null | undefined) => {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? null
		: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/** "2h 46m" reads faster than "166 min" for anything over an hour. */
const runtime = (minutes: number | null | undefined) => {
	if (minutes == null || minutes <= 0) return null;
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`.replace(' 0m', '');
};

const cash = (amount: number | null | undefined) => {
	if (amount == null || amount <= 0) return null;
	if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(2)}B`;
	if (amount >= 1_000_000) return `$${Math.round(amount / 1_000_000)}M`;
	return `$${Math.round(amount / 1_000)}K`;
};

/**
 * What to show on a card for the order it's in.
 *
 * Sorting by box office and then having to open each title to see the figure
 * is no use — the number you sorted on should be the number on the card.
 * Returns null where the card already shows it (year, your rating) or where
 * there's nothing to show.
 */
export function sortBadge(entry: Sortable, sort: string): string | null {
	switch (sort) {
		case 'runtime':
			return runtime(entry.runtimeMinutes);
		case 'box':
			return cash(entry.boxOffice);
		case 'imdb':
			return entry.imdbRating == null ? null : `IMDb ${entry.imdbRating.toFixed(1)}`;
		case 'rt':
			return entry.rtScore == null ? null : `RT ${entry.rtScore}%`;
		case 'metacritic':
			return entry.metascore == null ? null : `MC ${entry.metascore}`;
		case 'votes':
			return entry.externalVotes ? `${entry.externalVotes.toLocaleString()} votes` : null;
		case 'recent':
			return shortDate(entry.createdAt);
		case 'updated':
			return shortDate(entry.updatedAt);
		case 'finished':
			return shortDate(entry.finishedOn);
		default:
			// Title, year and the rating sorts are already on the card.
			return null;
	}
}
