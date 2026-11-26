import { json, error, type RequestHandler } from '@sveltejs/kit';
import { noteWatching, notePaused, freshenProgress } from '$lib/server/online';
import { currentProfile } from '$lib/server/profile';
import { markEpisodes, saveWatchProgress, getWatchProgress, listAllWatchProgress, listAllWatchProgressFull, clearAllWatchProgress, deleteWatchProgress, deleteTitleProgress, hideFromContinueWatching, watchedEpisodesForTitle } from '$lib/server/db/queries';

export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim();
	const type = url.searchParams.get('type') ?? 'movie';
	const season = Number(url.searchParams.get('season') ?? 0);
	const episode = Number(url.searchParams.get('episode') ?? 0);

	if (url.searchParams.get('all') === '1') {
		return json(listAllWatchProgressFull());
	}

	if (url.searchParams.get('debug') === '1') {
		return json(listAllWatchProgress());
	}

	if (!title) return error(400, 'Missing title');

	if (url.searchParams.get('episodes') === '1') {
		// (The player is choosing where the show was left: places from the other computers first.)
		await freshenProgress(currentProfile());
		return json(watchedEpisodesForTitle(title));
	}

	const progress = getWatchProgress(title, type, season, episode);
	return json(progress);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	if (body.assignLegacy === true) return error(410, 'Progress assignment has been removed');
	const { title, type, season, episode, currentTime, duration, subUrl, subDelay, subFileName, posterUrl, shareKey, fid, subRate } = body;

	if (!title) return error(400, 'Missing title');

	const t = type ?? 'movie';
	const s = season ?? 0;
	const e = episode ?? 0;
	const ct = currentTime ?? 0;
	const d = duration ?? 0;

	saveWatchProgress(title, t, s, e, ct, d, subUrl ?? '', subDelay ?? 0, subFileName ?? '', posterUrl ?? '', shareKey ?? '', fid ?? 0, Number(subRate) || 1, body.subByHand === true);
	// Friends see what's playing (Catalog online, when it's on and sharing is), only while it plays.
	if (body.paused === true) notePaused(currentProfile());
	else if (d > 0) noteWatching(currentProfile(), { title: String(title), type: t, season: Number(s) || 0, episode: Number(e) || 0, poster: String(posterUrl ?? '') });
	return json({ ok: true });
};

/** Mark episodes watched or not, by hand. Body: { title, episodes: [{ season, episode }], watched }. */
export const PATCH: RequestHandler = async ({ request }) => {
	const { title, episodes, watched } = await request.json();
	const valid =
		Array.isArray(episodes) &&
		episodes.length <= 2000 &&
		episodes.every((e) => Number.isInteger(e?.season) && Number.isInteger(e?.episode));
	if (!title || !valid) return error(400, 'Missing title or episodes');
	markEpisodes(String(title), episodes, Boolean(watched));
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim();
	if (title) {
		const type = url.searchParams.get('type') ?? 'movie';
		if (url.searchParams.get('hide') === '1') {
			hideFromContinueWatching(title, type);
		} else if (url.searchParams.get('all_episodes') === '1') {
			deleteTitleProgress(title, type);
		} else {
			const season = Number(url.searchParams.get('season') ?? 0);
			const episode = Number(url.searchParams.get('episode') ?? 0);
			deleteWatchProgress(title, type, season, episode);
		}
	} else {
		clearAllWatchProgress();
	}
	return json({ ok: true });
};
