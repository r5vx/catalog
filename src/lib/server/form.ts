/**
 * Turns the raw form fields into clean values ready for the database.
 * Empty boxes become null rather than empty strings, so "no rating" and
 * "rated zero" stay different things.
 */
export function parseEntryForm(data: FormData) {
	const text = (key: string) => {
		const value = data.get(key);
		return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
	};

	const number = (key: string) => {
		const value = text(key);
		if (value === null) return null;
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	};

	const title = text('title');
	if (!title) return { error: 'A title is required.' as const, values: null };

	const categoryId = number('categoryId');
	if (categoryId === null) return { error: 'Pick a category.' as const, values: null };

	const rating = number('rating');

	return {
		error: null,
		values: {
			title,
			categoryId,
			year: number('year'),
			status: text('status') ?? 'completed',
			rating: rating === null ? null : Math.min(10, Math.max(0, rating)),
			rewatches: Math.max(0, number('rewatches') ?? 0),
			favorite: data.get('favorite') === 'on',
			notes: (data.get('notes') as string | null)?.trim() ?? '',
			startedOn: text('startedOn'),
			finishedOn: text('finishedOn'),
			posterUrl: text('posterUrl'),
			lastSeason: number('lastSeason'),
			lastEpisode: number('lastEpisode')
		}
	};
}
