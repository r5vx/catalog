import { json, error, type RequestHandler } from '@sveltejs/kit';
import { saveWatchProgress, getWatchProgress, listAllWatchProgress, listAllWatchProgressFull, clearAllWatchProgress, deleteWatchProgress, deleteTitleProgress, watchedEpisodesForTitle } from '$lib/server/db/queries';

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
		return json(watchedEpisodesForTitle(title));
	}

	const progress = getWatchProgress(title, type, season, episode);
	return json(progress);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { title, type, season, episode, currentTime, duration, subUrl, subDelay, subFileName } = body;

	if (!title) return error(400, 'Missing title');

	const t = type ?? 'movie';
	const s = season ?? 0;
	const e = episode ?? 0;
	const ct = currentTime ?? 0;
	const d = duration ?? 0;

	if (d > 0 && ct / d >= 0.93) {
		deleteWatchProgress(title, t, s, e);
		return json({ ok: true });
	}

	saveWatchProgress(title, t, s, e, ct, d, subUrl ?? '', subDelay ?? 0, subFileName ?? '');
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim();
	if (title) {
		const type = url.searchParams.get('type') ?? 'movie';
		if (url.searchParams.get('all_episodes') === '1') {
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
