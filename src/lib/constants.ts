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
