import { error, json } from '@sveltejs/kit';
import { liveSports, setLiveSports } from '$lib/server/db/queries';
import { SPORTS } from '$lib/live';
import type { RequestHandler } from './$types';

/** The sports this profile sees on Live TV (null: not picked yet, so it's asked). */
export const GET: RequestHandler = async () => json({ sports: liveSports() });

/** { sports: [...] }: the sports picked (an empty list shows them all). */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!Array.isArray(body?.sports)) return error(400, 'Which sports?');
	const known = new Set(SPORTS.map((s) => s.key as string));
	setLiveSports(body.sports.filter((s: unknown) => typeof s === 'string' && known.has(s)));
	return json({ ok: true });
};
