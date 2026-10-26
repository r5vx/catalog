import { json, error } from '@sveltejs/kit';
import { updateSettings } from '$lib/server/settings';
import { addFebboxAccount } from '$lib/server/febboxAccounts';
import type { RequestHandler } from './$types';

/**
 * The desktop app's Febbox sign-in window saves what it signed in with here: the main account,
 * or (`more`) another one (src/lib/server/febboxAccounts.ts), kept only once Febbox says it's
 * signed in.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { token?: string; more?: boolean };
	const token = body?.token?.trim();

	if (!token) return error(400, 'No token');

	if (body.more) return json({ ok: true, result: await addFebboxAccount(token) });
	updateSettings({ febboxToken: token });
	return json({ ok: true });
};
