import { json } from '@sveltejs/kit';
import { readSpeech } from '$lib/server/heardSpeech';
import type { RequestHandler } from './$types';

/**
 * Asks the computer to hear an episode's sound track itself, in a window out of sight
 * (electron/main.cjs, page /speech-maker), so a TV can auto-time subtitles without doing that
 * work. Body: { title, type, year, season, episode, fid, lang }. Nothing if it's heard already.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const title = String(body?.title ?? '').trim();
	const fid = Number(body?.fid);
	const lang = String(body?.lang ?? '');
	if (!title || !Number.isInteger(fid) || fid <= 0 || !process.send) return json({ asked: false });
	if (readSpeech(fid, lang)) return json({ asked: false, done: true });
	const params = new URLSearchParams({
		title,
		type: body.type === 'tv' ? 'tv' : 'movie',
		year: String(body.year ?? ''),
		season: String(Number(body.season) || 0),
		episode: String(Number(body.episode) || 0),
		fid: String(fid),
		lang
	});
	process.send({ type: 'make-strip', path: `/speech-maker?${params}` });
	return json({ asked: true });
};
