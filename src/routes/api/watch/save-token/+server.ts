import { json, error } from '@sveltejs/kit';
import { updateSettings } from '$lib/server/settings';
import { addFebboxAccount, nameFebboxAccount } from '$lib/server/febboxAccounts';
import { onThisComputer } from '$lib/server/profile';
import type { RequestHandler } from './$types';

/** How the last "Add another account" went, for Settings to say (never the sign-in itself). */
let lastAdd: { at: number; result: string; name: string } | null = null;

/**
 * The desktop app's Febbox sign-in window saves what it signed in with here: the main account,
 * or (`more`) another one (src/lib/server/febboxAccounts.ts). `confirmed`: the window saw it
 * signed in on Febbox's own page; `name`: the account's name or email there.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { token?: string; more?: boolean; confirmed?: boolean; name?: string };
	const token = body?.token?.trim();

	if (!token) return error(400, 'No token');

	if (body.more) {
		const result = await addFebboxAccount(token, body.confirmed === true);
		if (result === 'added' || result === 'same') nameFebboxAccount(token, body.name);
		lastAdd = { at: Date.now(), result: result ?? 'unreachable', name: String(body.name ?? '').slice(0, 80) };
		return json({ ok: true, result });
	}
	updateSettings({ febboxToken: token });
	nameFebboxAccount(token, body.name);
	return json({ ok: true });
};

/** Settings asking how the account it's adding went: { at, result, name } or null. From the computer only (this path skips the PIN). */
export const GET: RequestHandler = async ({ request, getClientAddress }) => {
	let address = '';
	try {
		address = getClientAddress();
	} catch {}
	if (!onThisComputer(request.headers, address)) return error(403, 'Only from the computer Catalog runs on');
	return json(lastAdd);
};
