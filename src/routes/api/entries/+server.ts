import { json, error } from '@sveltejs/kit';
import { createFromResult } from '$lib/server/entries';
import { markEntryCompleted, incrementRewatches, updateSeasonEpisodeReached, deleteEntry } from '$lib/server/db/queries';
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

export const PATCH: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { id: number; action: string; season?: number; episode?: number };
	if (!body.id) return error(400, 'Missing id');

	if (body.action === 'complete') markEntryCompleted(body.id);
	else if (body.action === 'rewatch') incrementRewatches(body.id);
	else if (body.action === 'update_progress') {
		if (body.season == null || body.episode == null) return error(400, 'Missing season/episode');
		updateSeasonEpisodeReached(body.id, body.season, body.episode);
	}
	else return error(400, 'Unknown action');

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { id: number };
	if (!body.id) return error(400, 'Missing id');
	deleteEntry(body.id);
	return json({ ok: true });
};
