import { error, json } from '@sveltejs/kit';
import { checkPin, pinIsSet, sessionToken } from '$lib/server/settings';
import type { RequestHandler } from './$types';

/**
 * The PIN typed on the Roku: the sign-in it then sends as its catalog_auth cookie with every
 * request, the video's too (the Roku keeps it, as a browser keeps the cookie). { pin }.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!pinIsSet()) return json({ token: '' });
	if (!checkPin(String(body?.pin ?? ''))) return error(403, 'That PIN is not right.');
	return json({ token: sessionToken() });
};
