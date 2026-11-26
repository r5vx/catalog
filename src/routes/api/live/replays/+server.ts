import { json } from '@sveltejs/kit';
import { publisherReplayPage } from '$lib/server/sources/publisherReplays';
import { replayList } from '$lib/server/sources/replays';
import { replayCondensedOnly, replayNotReady } from '$lib/server/replayAnswer';
import type { RequestHandler } from './$types';

/**
 * Replays of past games (sources/replays.ts), newest first: for Live TV's Replays. Ones known not
 * to play yet are left out (server/replayAnswer.ts).
 */
export const GET: RequestHandler = async ({ url }) => {
	if (url.searchParams.get('publisher') === '1') return json(await publisherReplayPage(url.searchParams));
	const replays = (await replayList().catch(() => [])).filter((r) => !replayNotReady(r.id));
	return json({ replays: replays.map(({ page: _page, ...replay }) => ({ ...replay, condensed: replayCondensedOnly(replay.id) })) });
};
