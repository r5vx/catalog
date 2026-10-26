import { json } from '@sveltejs/kit';
import { replayList } from '$lib/server/sources/replays';
import { replayCondensedOnly, replayNotReady } from '$lib/server/replayAnswer';
import type { RequestHandler } from './$types';

/**
 * Replays of past games (sources/replays.ts), newest first: for Live TV's Replays. Ones known not
 * to play yet are left out (server/replayAnswer.ts).
 */
export const GET: RequestHandler = async () => {
	const replays = (await replayList().catch(() => [])).filter((r) => !replayNotReady(r.id));
	return json({ replays: replays.map(({ page: _page, ...replay }) => ({ ...replay, condensed: replayCondensedOnly(replay.id) })) });
};
