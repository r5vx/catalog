import { json } from '@sveltejs/kit';
import { addPlaybackStop, playbackStops } from '$lib/server/playbackLog';
import { reportProblem } from '$lib/server/online';
import type { RequestHandler } from './$types';

/** The stops kept (newest first). */
export const GET: RequestHandler = () => json(playbackStops());

/** A video stopped to load: what the player saw (src/lib/server/playbackLog.ts). */
export const POST: RequestHandler = async ({ request }) => {
	const seen = await request.json().catch(() => null);
	if (!seen || typeof seen !== 'object') return json({ ok: false }, { status: 400 });
	const stop = addPlaybackStop(seen as Record<string, unknown>);
	// Sent to the owner too (Settings → Online), when this Catalog is online and reports are on.
	reportProblem('stop', String((seen as { title?: unknown }).title ?? 'A video').slice(0, 160), stop);
	return json({ ok: true });
};
