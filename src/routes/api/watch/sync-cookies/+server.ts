import { json } from '@sveltejs/kit';
import { electronSyncCookies } from '$lib/server/electron-fetch';
import { isSignedIn } from '$lib/server/febboxFlow';
import { updateSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

/**
 * After the Febbox login window closes: its cookies are saved as the sign-in, but only once
 * Febbox says they are someone signed in. (A wrong password still leaves cookies behind, and
 * those were saved as "Logged in".) `signedIn: false`: nothing saved, the sign-in before stays.
 */
export const POST: RequestHandler = async () => {
	const result = await electronSyncCookies();

	if (result.error || !result.token) {
		return json({ ok: false, error: result.error || 'no cookies' });
	}

	// (Febbox not answering isn't a "no": saved as before.)
	if ((await isSignedIn(result.token)) === false) {
		return json({ ok: false, signedIn: false, error: 'not signed in' });
	}

	updateSettings({ febboxToken: result.token });
	return json({ ok: true });
};
