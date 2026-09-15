import { json, error } from '@sveltejs/kit';
import { createFromResult } from '$lib/server/entries';
import type { SearchResult } from '$lib/server/metadata';
import type { RequestHandler } from './$types';

/** Quick-add straight from a search result, without opening a form. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		result?: SearchResult;
		categoryId?: number;
		markWatchedToday?: boolean;
		lastSeason?: number | null;
		lastEpisode?: number | null;
		status?: string;
	};

	if (!body.result?.title) error(400, 'No result supplied.');

	const id = createFromResult(body.result, {
		categoryId: body.categoryId,
		status: body.status,
		markWatchedToday: body.markWatchedToday ?? true,
		lastSeason: body.lastSeason ?? null,
		lastEpisode: body.lastEpisode ?? null
	});

	return json({ id });
};
