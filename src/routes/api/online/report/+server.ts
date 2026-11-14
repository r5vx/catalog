import { json } from '@sveltejs/kit';
import { reportProblem } from '$lib/server/online';
import type { RequestHandler } from './$types';

/** A problem the player noticed (subtitles that wouldn't match): sent to the owner if reports are on. Body: { kind, title, details }. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const kind = body?.kind === 'subtitles' ? 'subtitles' : 'other';
	if (typeof body?.title === 'string' && body.title) reportProblem(kind, body.title.slice(0, 160), body.details ?? null);
	return json({ ok: true });
};
