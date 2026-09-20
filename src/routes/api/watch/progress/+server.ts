import { json, error, type RequestHandler } from '@sveltejs/kit';
import { saveWatchProgress, getWatchProgress, listAllWatchProgress, listAllWatchProgressFull, clearAllWatchProgress, deleteWatchProgress } from '$lib/server/db/queries';

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

	const progress = getWatchProgress(title, type, season, episode);
	return json(progress);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { title, type, season, episode, currentTime, duration, subUrl, subDelay, subFileName } = body;

	if (!title) return error(400, 'Missing title');

	saveWatchProgress(
		title,
		type ?? 'movie',
		season ?? 0,
		episode ?? 0,
		currentTime ?? 0,
		duration ?? 0,
		subUrl ?? '',
		subDelay ?? 0,
		subFileName ?? ''
	);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim();
	if (title) {
		const type = url.searchParams.get('type') ?? 'movie';
		const season = Number(url.searchParams.get('season') ?? 0);
		const episode = Number(url.searchParams.get('episode') ?? 0);
		deleteWatchProgress(title, type, season, episode);
	} else {
		clearAllWatchProgress();
	}
	return json({ ok: true });
};
