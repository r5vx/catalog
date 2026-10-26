import { json } from '@sveltejs/kit';
import { liveSchedule } from '$lib/server/sources/daddylive';
import { withArt } from '$lib/server/teamArt';
import { withScores } from '$lib/server/liveScores';
import type { RequestHandler } from './$types';

/** Just the scores, by game (Live TV asks every minute while it's open; the guide is bigger). */
export const GET: RequestHandler = async () => {
	const games = await withScores(await withArt(await liveSchedule().catch(() => [])));
	return json({ scores: Object.fromEntries(games.filter((g) => g.score).map((g) => [g.id, g.score])) });
};
