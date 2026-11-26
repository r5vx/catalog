import { requireOwner } from '$lib/server/ownerSession';
import { json } from '@sveltejs/kit';
import { cloud } from '$lib/server/online';
import type { RequestHandler } from './$types';

/**
 * How much the meeting point is used, per day, for the last 30 days, with the free plan's limits:
 * read with the owner's key (Settings → Online → Server use). The server counts it itself.
 */
export const GET: RequestHandler = async ({ cookies }) => {
	requireOwner(cookies);
	const answer = await cloud('/v1/usage', { admin: true });
	return answer.ok ? json(answer.data) : json({ error: answer.error }, { status: answer.status || 502 });
};
