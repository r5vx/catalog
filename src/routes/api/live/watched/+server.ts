import { error, json } from '@sveltejs/kit';
import { noteLiveWatched, noteReplayWatched } from '$lib/server/db/queries';
import { noteChannelPlayed } from '$lib/server/liveChannelPicks';
import type { RequestHandler } from './$types';

/**
 * Something on Live TV started playing:
 * - a channel ({ id, name }): first in "Watched lately";
 * - a channel's verdict ({ id, ok, league, sport }; ok true: it played a minute, false: it wouldn't
 *   play, or was left within a minute), counted toward one-click channels (liveChannelPicks.ts);
 * - a replay ({ replay, title, poster, sport }): first in Recently watched, and its place shows in
 *   Continue Watching while it's part-way.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (typeof body?.replay === 'string' && body.replay && typeof body.title === 'string' && body.title) {
		noteReplayWatched(body.replay, body.title, { poster: typeof body.poster === 'string' ? body.poster : null, sport: String(body.sport ?? 'other') });
		return json({ ok: true });
	}
	if (!Number.isInteger(body?.id) || body.id <= 0) return error(400, 'Which channel?');
	if (typeof body.ok === 'boolean') {
		noteChannelPlayed(String(body.league ?? ''), String(body.sport ?? ''), body.id, body.ok);
		return json({ ok: true });
	}
	noteLiveWatched(body.id, String(body.name ?? `Channel ${body.id}`));
	return json({ ok: true });
};
