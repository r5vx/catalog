import { json } from '@sveltejs/kit';
import { reportProblem } from '$lib/server/online';
import { reportScreen } from '$lib/server/reportScreen';
import type { RequestHandler } from './$types';

/**
 * A problem a screen noticed, sent to the owner if reports are on: subtitles that wouldn't match,
 * a video that wouldn't play, an error on a page (src/lib/problemReport.ts). Body: { kind, title,
 * details }. Which screen it came from and who was watching are added here.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const kind = body?.kind === 'subtitles' || body?.kind === 'error' ? body.kind : 'other';
	const details = body?.details && typeof body.details === 'object' ? body.details : {};
	if (typeof body?.title === 'string' && body.title) reportProblem(kind, body.title.slice(0, 160), { ...reportScreen(request), ...details });
	return json({ ok: true });
};
