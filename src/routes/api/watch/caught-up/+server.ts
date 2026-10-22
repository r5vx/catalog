import { json, error } from '@sveltejs/kit';
import { caughtUpSummary, dismissNewEpisode, noteCaughtUp } from '$lib/server/db/queries';
import { checkNewEpisodes } from '$lib/server/newEpisodes';
import type { RequestHandler } from './$types';

/**
 * A show watched to its last playable episode (src/lib/server/newEpisodes.ts).
 * Body { title, year, season, episode }: caught up there. { title, dismiss: true }: its "New"
 * mark goes.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const title = typeof body?.title === 'string' ? body.title.trim() : '';
	if (!title) return error(400, 'Missing title');
	if (body.dismiss) {
		dismissNewEpisode(title);
		return json({ ok: true });
	}
	const season = Number(body.season);
	const episode = Number(body.episode);
	if (!Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 1) return error(400, 'Missing episode');
	noteCaughtUp(title, String(body.year ?? ''), season, episode);
	return json({ ok: true });
};

/** What's caught up and what's been found. ?check=1 looks for new episodes now first. */
export const GET: RequestHandler = async ({ url }) => {
	if (url.searchParams.get('check') === '1') await checkNewEpisodes();
	return json(caughtUpSummary());
};
