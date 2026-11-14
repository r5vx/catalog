import { error, json } from '@sveltejs/kit';
import { cloud } from '$lib/server/online';
import { currentProfile } from '$lib/server/profile';
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
	['POST', /^friends\/(code|add)$/],
	['DELETE', /^friends\/[A-Z0-9]{16}$/],
	['GET', /^seen$/],
	['POST', /^rooms$/],
	['GET', /^rooms\/[A-Z0-9]{6}$/],
	['POST', /^rooms\/[A-Z0-9]{6}\/(join|leave)$/],
	['PUT', /^rooms\/[A-Z0-9]{6}\/state$/]
];

const pass: RequestHandler = async ({ request, params, url }) => {
	const path = params.path ?? '';
	if (!ALLOWED.some(([method, shape]) => method === request.method && shape.test(path))) return error(404, 'No such address');
	const body = request.method === 'GET' || request.method === 'DELETE' ? undefined : await request.json().catch(() => ({}));
	const answer = await cloud(`/v1/${path}${url.search}`, { method: request.method, body, profile: currentProfile() });
	if (!answer.ok) return json({ error: answer.error }, { status: answer.status || 502 });
	return json(answer.data);
};

export const GET = pass;
export const POST = pass;
export const PUT = pass;
export const DELETE = pass;
