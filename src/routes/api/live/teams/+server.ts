import { error, json } from '@sveltejs/kit';
import { saveLive, unsaveLive } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

/**
 * A favorite team, for this profile (Live TV puts its games first, under "Your teams"):
 * { team: { name, logo, color }, saved: true or false }. The name is ESPN's, as the game
 * pictures have it (server/teamArt.ts).
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const team = body?.team;
	if (typeof team?.name !== 'string' || !team.name) return error(400, 'Which team?');
	if (body.saved === false) unsaveLive('team', team.name);
	else saveLive('team', team.name, team.name, JSON.stringify({ name: team.name, logo: String(team.logo ?? ''), color: String(team.color ?? '') }));
	return json({ ok: true });
};
