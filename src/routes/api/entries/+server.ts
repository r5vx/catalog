import { json, error } from '@sveltejs/kit';
import { createFromResult } from '$lib/server/entries';
import { entryBasics, setEntryStatus, markEntryCompleted, incrementRewatches, updateSeasonEpisodeReached, deleteEntry, completeProfileTitle, hideCompletedFromContinueWatching, profileTitleReached, deleteProfileTitle, setEntryFields, type QuickFields } from '$lib/server/db/queries';
import { STATUSES } from '$lib/constants';
import { showStillAiring } from '$lib/server/stillAiring';
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
	const body = (await request.json()) as { id: number; action: string; season?: number; episode?: number; status?: string; fields?: Record<string, unknown> };
	if (!body.id) return error(400, 'Missing id');

	// Someone else's profile on the TV: the id is a title on their own list. Only what the
	// player does (Autosync) reaches here from there; the library itself isn't theirs to change.
	if (currentProfile() !== MAIN_PROFILE) {
		if (body.action === 'complete' || body.action === 'finished_show') {
			completeProfileTitle(body.id);
			// Marked completed by hand: out of Continue Watching too.
			if (body.action === 'complete') hideCompletedFromContinueWatching(body.id);
		} else if (body.action === 'status') return json({ ok: true });
		else if (body.action === 'update_progress' && body.season != null && body.episode != null) profileTitleReached(body.id, body.season, body.episode);
		else return error(403, 'Not on this profile');
		return json({ ok: true });
	}

	if (body.action === 'complete') {
		markEntryCompleted(body.id);
		// Marked completed by hand: out of Continue Watching too.
		hideCompletedFromContinueWatching(body.id);
	} else if (body.action === 'finished_show') {
		// The player reached the end of the last episode out: a rewatch done (Completed, once more);
		// otherwise Caught up while the show is still going, Completed once it has ended.
		const entry = entryBasics(body.id);
		if (!entry) return error(404, 'No such entry');
		if (entry.status === 'rewatching') {
			markEntryCompleted(body.id);
			incrementRewatches(body.id);
			return json({ ok: true, status: 'completed' });
		}
		const status = (await showStillAiring(entry.title, entry.year ? String(entry.year) : '')) ? 'caught_up' : 'completed';
		if (status === 'completed') markEntryCompleted(body.id);
		else setEntryStatus(body.id, status);
		return json({ ok: true, status });
	} else if (body.action === 'status' && (body.status === 'rewatching' || body.status === 'watching')) {
		// The player: a watched show started again from earlier on, or a new episode of one.
		setEntryStatus(body.id, body.status);
	} else if (body.action === 'rewatch') incrementRewatches(body.id);
	else if (body.action === 'set') {
		// The clicks on an entry's page, and the player's "Rate it": only the fields sent change.
		const fields = quickFields(body.fields ?? {});
		if (!fields) return error(400, 'Nothing to change');
		return json({ ok: true, ...setEntryFields(body.id, fields) });
	}
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

/** The quick fields from a request, checked: a rating 0–10 (or none), a known status, and so on. */
function quickFields(raw: Record<string, unknown>): QuickFields | null {
	const fields: QuickFields = {};
	const count = (value: unknown, most: number) => {
		if (value === null) return null;
		const n = Number(value);
		return Number.isFinite(n) ? Math.min(most, Math.max(0, Math.round(n))) : undefined;
	};
	if ('rating' in raw) {
		const n = raw.rating === null ? null : Number(raw.rating);
		if (n === null) fields.rating = null;
		else if (Number.isFinite(n)) fields.rating = Math.min(10, Math.max(0, Math.round(n * 2) / 2));
	}
	if (typeof raw.status === 'string' && STATUSES.some((s) => s.value === raw.status)) fields.status = raw.status;
	if (typeof raw.favorite === 'boolean') fields.favorite = raw.favorite;
	if ('rewatches' in raw) {
		const n = count(raw.rewatches, 999);
		if (typeof n === 'number') fields.rewatches = n;
	}
	if ('lastSeason' in raw) {
		const n = count(raw.lastSeason, 999);
		if (n !== undefined) fields.lastSeason = n;
	}
	if ('lastEpisode' in raw) {
		const n = count(raw.lastEpisode, 9999);
		if (n !== undefined) fields.lastEpisode = n;
	}
	return Object.keys(fields).length ? fields : null;
}
