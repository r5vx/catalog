import { json } from '@sveltejs/kit';
import { noteSpeechAsked, noteSpeechOutcome, readSpeech, speechIsPartial } from '$lib/server/heardSpeech';
import type { RequestHandler } from './$types';

/** Asked lately (Showbox file + language → when): another TV, or the same one again, doesn't queue it twice. */
const asked = new Map<string, number>();
const ASKED_FOR = 15 * 60 * 1000;

/**
 * Asks the computer to hear an episode's sound track itself, in a window out of sight
 * (electron/main.cjs, page /speech-maker), so a TV can auto-time subtitles without doing that
 * work. Body: { title, type, year, season, episode, fid, lang, from }: `from` is where the TV is,
 * heard first. Nothing if it's heard already (all of it), or was asked for in the last 15 minutes.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const title = String(body?.title ?? '').trim();
	const fid = Number(body?.fid);
	const lang = String(body?.lang ?? '');
	if (!title || !Number.isInteger(fid) || fid <= 0 || !process.send) return json({ asked: false });
	if (readSpeech(fid, lang) && !speechIsPartial(fid, lang)) return json({ asked: false, done: true });
	const key = `${fid}|${lang}`;
	if (Date.now() - (asked.get(key) ?? 0) < ASKED_FOR) return json({ asked: false, already: true });
	asked.set(key, Date.now());
	noteSpeechAsked(fid, lang);
	const params = new URLSearchParams({
		title,
		type: body.type === 'tv' ? 'tv' : 'movie',
		year: String(body.year ?? ''),
		season: String(Number(body.season) || 0),
		episode: String(Number(body.episode) || 0),
		fid: String(fid),
		lang,
		from: String(Math.max(0, Math.round(Number(body.from) || 0)))
	});
	process.send({ type: 'make-strip', path: `/speech-maker?${params}` });
	return json({ asked: true });
};

/** /speech-maker saying it ended without hearing anything: { fid, lang, outcome }. */
export const PUT: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const fid = Number(body?.fid);
	if (Number.isInteger(fid) && fid > 0) noteSpeechOutcome(fid, String(body?.lang ?? ''), String(body?.outcome ?? ''));
	return json({ ok: true });
};
