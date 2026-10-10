import { readSettings, updateSettings } from './settings';
import { electronSyncCookies } from './electron-fetch';

/**
 * Whether Catalog's Showbox (Febbox) sign-in still works, without asking Febbox.
 *
 * The sign-in saved in Settings → Services is Febbox's cookies. Febbox writes a date into its
 * "ui" cookie after which it stops accepting it (about a year after signing in) — that date is
 * Febbox's, not Catalog's. An expired one doesn't fail loudly (episodes just won't load), so the
 * app says so once it has run out, or when there's no sign-in at all.
 *
 * Catalog's own window keeps Febbox's cookies too, and Febbox can hand out a fresh one while
 * Catalog uses it: `keepShowboxSigninFresh` copies a longer-lasting one into the saved sign-in,
 * so it only runs out if Febbox stops renewing it.
 */
export type ShowboxSignin = { state: 'ok' | 'missing' | 'expired' };

/** When a saved sign-in stops working (ms), or 0 when it doesn't say. */
function expiresAt(token: string): number {
	const ui = token.match(/(?:^|;\s*)ui=([^;]+)/)?.[1];
	if (!ui) return 0;
	try {
		const claims = JSON.parse(Buffer.from(ui.split('.')[1] ?? '', 'base64url').toString('utf8'));
		return Number(claims.exp) * 1000 || 0;
	} catch {
		return 0;
	}
}

export function showboxSignin(): ShowboxSignin {
	const token = readSettings().febboxToken ?? '';
	if (!token.trim()) return { state: 'missing' };
	const expires = expiresAt(token);
	return { state: expires && expires <= Date.now() ? 'expired' : 'ok' };
}

let renewing = false;

/** Saves the sign-in Catalog's window holds when it lasts longer than the saved one. */
export async function keepShowboxSigninFresh(): Promise<void> {
	if (renewing) return;
	renewing = true;
	try {
		const held = await electronSyncCookies();
		if (held.error || !held.token) return;
		const saved = readSettings().febboxToken ?? '';
		const heldUntil = expiresAt(held.token);
		if (heldUntil > Date.now() && heldUntil > expiresAt(saved)) updateSettings({ febboxToken: held.token });
	} catch {
		// Not in the desktop app, or it didn't answer: the saved sign-in stays as it is.
	} finally {
		renewing = false;
	}
}
