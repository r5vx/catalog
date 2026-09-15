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

/** How the library can be ordered. `column` maps to a real database column. */
export const SORTS = [
	{ value: 'recent', label: 'Recently added', column: 'created_at', dir: 'desc' },
	{ value: 'updated', label: 'Recently updated', column: 'updated_at', dir: 'desc' },
	{ value: 'rating', label: 'My rating', column: 'rating', dir: 'desc' },
	{ value: 'public', label: 'Public rating', column: 'external_rating', dir: 'desc' },
	{ value: 'votes', label: 'Most voted on', column: 'external_votes', dir: 'desc' },
	{ value: 'title', label: 'Title (A–Z)', column: 'title', dir: 'asc' },
	{ value: 'year', label: 'Newest release', column: 'year', dir: 'desc' },
	{ value: 'rewatches', label: 'Most rewatched', column: 'rewatches', dir: 'desc' },
	{ value: 'finished', label: 'Recently finished', column: 'finished_on', dir: 'desc' }
] as const;

export type SortValue = (typeof SORTS)[number]['value'];
