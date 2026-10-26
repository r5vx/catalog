import { error, json } from '@sveltejs/kit';
import { liveSavedList, saveLive, unsaveLive } from '$lib/server/db/queries';
import { liveGame } from '$lib/server/sources/daddylive';
import type { RequestHandler } from './$types';

/** What this profile has saved: the channels' numbers and the games' ids (for the player's star). */
export const GET: RequestHandler = async () => {
	const saved = liveSavedList();
	return json({
		channels: saved.filter((r) => r.kind === 'channel').map((r) => Number(r.key)),
		games: saved.filter((r) => r.kind === 'game').map((r) => r.key)
	});
};

/**
 * Saves a channel or a game to Live TV's Saved, or takes it off: { kind: 'channel', id, name }
 * or { kind: 'game', game } (or { kind: 'game', id }, from the Roku: the game as the schedule has
 * it), with saved: true or false.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const saved = body?.saved !== false;
	if (body?.kind === 'channel' && Number.isInteger(body.id)) {
		if (saved) saveLive('channel', String(body.id), String(body.name ?? `Channel ${body.id}`));
		else unsaveLive('channel', String(body.id));
	} else if (body?.kind === 'game' && (typeof body.game?.id === 'string' || typeof body.id === 'string')) {
		if (!saved) unsaveLive('game', body.game?.id ?? body.id);
		else {
			const game = body.game ?? (await liveGame(body.id));
			if (!game) return error(404, "That game isn't on the schedule.");
			saveLive('game', game.id, String(game.title ?? ''), JSON.stringify(game));
		}
	} else return error(400, 'Which channel or game?');
	return json({ ok: true });
};
