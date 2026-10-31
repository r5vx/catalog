import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * The computer's mini player (electron/miniPlayer.cjs). Body: { open: "/watch?…" } to open it,
 * or { back: seconds, playing, season, episode, fid, reopen, path } as it goes back to the big window
 * (`reopen`: its "Back to Catalog", which opens `path` if the big window is on another page). 409 outside the desktop app
 * (a phone, `npm run dev`): the player then uses the browser's picture-in-picture.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (typeof process.send !== 'function' || !process.env.CATALOG_DESKTOP) return error(409, 'Not in the desktop app');
	const body = await request.json().catch(() => null);
	if (typeof body?.open === 'string' && body.open.startsWith('/watch?')) {
		process.send({ type: 'mini-open', path: body.open });
		return json({ ok: true });
	}
	if (body && 'back' in body) {
		const number = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : undefined);
		process.send({
			type: 'mini-back',
			at: number(body.back) ?? null,
			playing: Boolean(body.playing),
			season: number(body.season),
			episode: number(body.episode),
			fid: number(body.fid),
			reopen: Boolean(body.reopen),
			path: typeof body.path === 'string' && body.path.startsWith('/watch?') ? body.path : undefined
		});
		return json({ ok: true });
	}
	return error(400, 'Nothing to do');
};
