import { json, error } from '@sveltejs/kit';
import { searchAll } from '$lib/server/metadata';
import { createFromResult } from '$lib/server/entries';
import { entryIdForSource } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const { title, type } = (await request.json()) as { title: string; type: string };
	if (!title) return error(400, 'Missing title');

	const results = await searchAll(title, { limit: 5 });
	if (!results.length) return json({ error: 'not_found' });

	const categoryMatch = type === 'movie' ? 'movies' : type === 'tv' ? ['tv', 'anime'] : null;
	const best = categoryMatch
		? results.find(r => Array.isArray(categoryMatch) ? categoryMatch.includes(r.categorySlug) : r.categorySlug === categoryMatch) ?? results[0]
		: results[0];

	const existing = entryIdForSource(best.source, best.sourceId);
	if (existing) return json({ id: existing, already: true });

	const id = createFromResult(best, {
		status: 'completed',
		markWatchedToday: true
	});

	return json({ id, title: best.title });
};
