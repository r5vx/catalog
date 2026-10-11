import { json } from '@sveltejs/kit';
import { stripKey, stripSize } from '$lib/server/previewStrips';
import type { RequestHandler } from './$types';

/**
 * Asks the computer to make a video's preview pictures itself, in a window out of sight
 * (electron/main.cjs, page /strip-maker): for a TV playing it (TVs don't gather their own), and
 * for the next episode. Body: { title, type, season, episode, year }. Nothing if it's done already.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const title = String(body?.title ?? '').trim();
	if (!title || !process.send) return json({ asked: false });
	const type = body.type === 'tv' ? 'tv' : 'movie';
	const season = Number(body.season) || 0;
	const episode = Number(body.episode) || 0;
	// About one a minute across a 24-minute episode is already a usable strip; more fills in.
	if (stripSize(stripKey(title, type, season, episode)) >= 60) return json({ asked: false, done: true });
	const params = new URLSearchParams({ title, type, season: String(season), episode: String(episode), year: String(body.year ?? '') });
	process.send({ type: 'make-strip', path: `/strip-maker?${params}` });
	return json({ asked: true });
};
