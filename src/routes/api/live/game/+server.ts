import { json } from '@sveltejs/kit';
import { liveGame } from '$lib/server/sources/daddylive';
import type { RequestHandler } from './$types';

/** One game on the schedule (?id=), for the player's list of its other channels. */
export const GET: RequestHandler = async ({ url }) => {
	const game = await liveGame(url.searchParams.get('id') ?? '').catch(() => null);
	return json({ game });
};
