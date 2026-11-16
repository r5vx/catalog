import { error, json } from '@sveltejs/kit';
import { cloud, keepFriendsAnswer, keepMe } from '$lib/server/online';
import { currentProfile } from '$lib/server/profile';
import { withNicknames } from '$lib/server/friendNicknames';
import type { RequestHandler } from './$types';

/**
 * The pages' way to the meeting point (src/lib/server/online.ts), as the profile that's asking:
 * friends, watching together, joining an account. The house's key never leaves this server, and
 * only the addresses listed here are passed on.
 */
const ALLOWED: [string, RegExp][] = [
	['PUT', /^me$/],
	['POST', /^signout$/],
	['POST', /^link\/(code|join)$/],
	['POST', /^google\/start$/],
	['GET', /^friends$/],
	['POST', /^friends\/(code|add|request|unrequest|answer)$/],
	['DELETE', /^friends\/[A-Z0-9]{16}$/],
	['GET', /^friends\/[A-Z0-9]{16}\/friends$/],
	['GET', /^activity$/],
	['GET', /^seen$/],
	['PUT', /^profile$/],
	['PUT', /^privacy$/],
	['GET', /^people\/[A-Z0-9]{16}\/(profile|library)$/],
	['GET', /^messages$/],
	['POST', /^messages$/],
	['GET', /^messages\/threads$/],
	['GET', /^messages\/with\/[A-Z0-9]{16}$/],
	['POST', /^messages\/read$/],
	['POST', /^rooms$/],
	['GET', /^rooms\/[A-Z0-9]{6}$/],
	['POST', /^rooms\/[A-Z0-9]{6}\/(join|leave)$/],
	['PUT', /^rooms\/[A-Z0-9]{6}\/state$/]
];

const pass: RequestHandler = async ({ request, params, url }) => {
	const path = params.path ?? '';
	if (!ALLOWED.some(([method, shape]) => method === request.method && shape.test(path))) return error(404, 'No such address');
	const body = request.method === 'GET' || request.method === 'DELETE' ? undefined : await request.json().catch(() => ({}));
	const profile = currentProfile();
	const answer = await cloud(`/v1/${path}${url.search}`, { method: request.method, body, profile });
	if (!answer.ok) return json({ error: answer.error }, { status: answer.status || 502 });
	// Friends' nicknames (kept on this computer) instead of the names they picked.
	const data = withNicknames(profile, answer.data);
	// Kept, so the Friends page can show them at once next time it opens.
	if (request.method === 'GET' && (path === 'friends' || path === 'activity')) keepFriendsAnswer(profile, path, data);
	// Who this profile is online, for the My profile button (a new name or picture shows there at once).
	if (path === 'friends' && request.method === 'GET') keepMe(profile, (answer.data as { me?: unknown })?.me);
	if (path === 'me') keepMe(profile, (answer.data as { account?: unknown })?.account);
	return json(data);
};

export const GET = pass;
export const POST = pass;
export const PUT = pass;
export const DELETE = pass;
