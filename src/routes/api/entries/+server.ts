import { json, error } from '@sveltejs/kit';
import { createFromResult } from '$lib/server/entries';
import { markEntryCompleted, incrementRewatches, updateSeasonEpisodeReached, deleteEntry, completeProfileTitle, profileTitleReached, deleteProfileTitle } from '$lib/server/db/queries';
import { currentProfile, MAIN_PROFILE } from '$lib/server/profile';
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
	if (currentProfile() !== MAIN_PROFILE) error(403, 'Not on this profile');

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

	// Someone else's profile on the TV: the id is a title on their own list. Only what the
	// player does (Autosync) reaches here from there; the library itself isn't theirs to change.
	if (currentProfile() !== MAIN_PROFILE) {
		if (body.action === 'complete') completeProfileTitle(body.id);
		else if (body.action === 'update_progress' && body.season != null && body.episode != null) profileTitleReached(body.id, body.season, body.episode);
		else return error(403, 'Not on this profile');
		return json({ ok: true });
	}

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
	// Someone else's profile on the TV: off their own list (the library itself isn't theirs).
	if (currentProfile() !== MAIN_PROFILE) {
		deleteProfileTitle(body.id);
		return json({ ok: true });
	}
	deleteEntry(body.id);
	return json({ ok: true });
};
