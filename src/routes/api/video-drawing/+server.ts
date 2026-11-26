import { json } from '@sveltejs/kit';
import { setVideoDrawing, videoDrawing } from '$lib/server/videoDrawing';
import type { RequestHandler } from './$types';

/** Settings → Playback → Picture: { noOverlay } for this computer's Catalog window (after a restart). */
export const GET: RequestHandler = () => json(videoDrawing());

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (typeof body?.noOverlay !== 'boolean') return json({ error: 'On or off?' }, { status: 400 });
	setVideoDrawing(body.noOverlay);
	return json(videoDrawing());
};
