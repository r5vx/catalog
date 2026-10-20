import { json } from '@sveltejs/kit';
import { addPlaybackStop, playbackStops } from '$lib/server/playbackLog';
import type { RequestHandler } from './$types';

/** The stops kept (newest first). */
export const GET: RequestHandler = () => json(playbackStops());

/** A video stopped to load: what the player saw (src/lib/server/playbackLog.ts). */
export const POST: RequestHandler = async ({ request }) => {
	const seen = await request.json().catch(() => null);
	if (!seen || typeof seen !== 'object') return json({ ok: false }, { status: 400 });
	addPlaybackStop(seen as Record<string, unknown>);
	return json({ ok: true });
};
