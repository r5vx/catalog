import { json } from '@sveltejs/kit';
import { getOrderCache } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

/**
 * Asks the computer to find an episode's intro and credits itself, in a window out of sight
 * (electron/main.cjs, page /skip-maker): for a TV playing it, since comparing sound would
 * compete with the TV's own video. Body: { title, year, season, episode, fid }. Nothing if
 * it's been looked for already.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const title = String(body?.title ?? '').trim();
	const fid = Number(body?.fid);
	if (!title || !Number.isInteger(fid) || fid <= 0 || !process.send) return json({ asked: false });
	if (getOrderCache(`skip-found|${fid}`)) return json({ asked: false, done: true });
	const params = new URLSearchParams({
		title,
		year: String(body.year ?? ''),
		season: String(Number(body.season) || 0),
		episode: String(Number(body.episode) || 0),
		fid: String(fid)
	});
	process.send({ type: 'make-strip', path: `/skip-maker?${params}` });
	return json({ asked: true });
};
