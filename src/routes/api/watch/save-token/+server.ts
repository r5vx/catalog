import { json, error } from '@sveltejs/kit';
import { updateSettings } from '$lib/server/settings';
import { addFebboxAccount, nameFebboxAccount } from '$lib/server/febboxAccounts';
import { onThisComputer } from '$lib/server/profile';
import type { RequestHandler } from './$types';

/**
 * How the last sign-in window went, for Settings to say (never the sign-in itself): `more` for
 * "Add another account", `main` for "Log in again". 'open' while its window is still open.
 *
 * Settings used to decide by itself that the window had closed, but Google's sign-in pages cut a
 * window off from the page that opened it (their Cross-Origin-Opener-Policy), so it looked closed
 * the moment Google's page loaded. Settings gave up 30 s later and said "No account was added"
 * while someone was still signing in (2026-11-08). Now the app says when the window really closes.
 */
type Outcome = { at: number; result: string; name: string };
const last: Record<'more' | 'main', Outcome | null> = { more: null, main: null };

/**
 * The desktop app's Febbox sign-in window saves what it signed in with here: the main account,
 * or (`more`) another one (src/lib/server/febboxAccounts.ts). `confirmed`: the window saw it
 * signed in on Febbox's own page; `name`: the account's name or email there.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { token?: string; more?: boolean; confirmed?: boolean; name?: string; stage?: string };
	const kind = body?.more ? 'more' : 'main';
	// The window opened, or closed without anyone signed in (no Febbox cookies at all).
	if (body?.stage === 'open' || body?.stage === 'closed') {
		last[kind] = { at: Date.now(), result: body.stage, name: '' };
		return json({ ok: true });
	}
	const token = body?.token?.trim();

	if (!token) return error(400, 'No token');

	if (body.more) {
		const result = await addFebboxAccount(token, body.confirmed === true);
		if (result === 'added' || result === 'same') nameFebboxAccount(token, body.name);
		last.more = { at: Date.now(), result: result ?? 'unreachable', name: String(body.name ?? '').slice(0, 80) };
		return json({ ok: true, result });
	}
	// Unconfirmed (the window closed before Febbox's page said signed in): not saved here. Settings
	// then asks sync-cookies, which saves them only if Febbox doesn't say they're nobody.
	if (body.confirmed) {
		updateSettings({ febboxToken: token });
		nameFebboxAccount(token, body.name);
	}
	last.main = { at: Date.now(), result: body.confirmed ? 'saved' : 'cookies', name: String(body.name ?? '').slice(0, 80) };
	return json({ ok: true });
};

/**
 * Settings asking how its sign-in window went (?kind=main for "Log in again"): { at, result, name }
 * or null. From the computer only (this path skips the PIN).
 */
export const GET: RequestHandler = async ({ request, url, getClientAddress }) => {
	let address = '';
	try {
		address = getClientAddress();
	} catch {}
	if (!onThisComputer(request.headers, address)) return error(403, 'Only from the computer Catalog runs on');
	return json(last[url.searchParams.get('kind') === 'main' ? 'main' : 'more']);
};
