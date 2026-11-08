import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { youTubeWindowOpen } from '$lib/server/youtubeWindowState';
import { onThisComputer } from '$lib/server/profile';
import { readSettings, updateSettings } from '$lib/server/settings';
import { youtubePhoneAccount, youtubePhoneAccounts } from '$lib/server/youtubePhone';
import { profileExists } from '$lib/server/db/queries';

const inDesktop = () => typeof process.send === 'function' && !!process.env.CATALOG_DESKTOP;

function fromTheComputer(request: Request, getClientAddress: () => string): boolean {
	let address = '';
	try {
		address = getClientAddress();
	} catch {}
	return onThisComputer(request.headers, address);
}

/**
 * Opens YouTube (electron/youtubeWindow.cjs): in its own window, or over all of Catalog's window
 * when the YouTube page's switch is on. 409 outside the desktop app; 403 from a phone (it would
 * open on the computer).
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	if (!inDesktop()) return error(409, 'Not in the desktop app');
	if (!fromTheComputer(request, getClientAddress)) return error(403, 'Only on the computer Catalog runs on');
	process.send!({ type: 'youtube-open', inside: readSettings().youtubeInside === '1' });
	return json({ ok: true });
};

/** The YouTube page's switch: `{ inside: true }` opens it over Catalog's window from now on. */
export const PUT: RequestHandler = async ({ request, getClientAddress }) => {
	if (!fromTheComputer(request, getClientAddress)) return error(403, 'Only on the computer Catalog runs on');
	const body = (await request.json().catch(() => null)) as { inside?: unknown } | null;
	updateSettings({ youtubeInside: body?.inside === true ? '1' : '' });
	return json({ inside: body?.inside === true });
};

/**
 * Whether YouTube is showing (Catalog's YouTube page shows Open again once it's closed), and whose
 * phones are signed in to YouTube.
 */
export const GET: RequestHandler = async () => {
	if (!inDesktop()) return error(409, 'Not in the desktop app');
	return json({ open: youTubeWindowOpen(), accounts: youtubePhoneAccounts() });
};

/** `{ profile, action: 'signin' | 'signout' }`: someone's YouTube account for their phones. */
export const PATCH: RequestHandler = async ({ request, getClientAddress }) => {
	if (!inDesktop()) return error(409, 'Not in the desktop app');
	if (!fromTheComputer(request, getClientAddress)) return error(403, 'Only on the computer Catalog runs on');
	const body = (await request.json().catch(() => null)) as { profile?: unknown; action?: unknown } | null;
	const profile = Number(body?.profile);
	if (!Number.isInteger(profile) || !profileExists(profile)) return error(400, 'No such profile');
	if (body?.action !== 'signin' && body?.action !== 'signout') return error(400, 'Missing action');
	youtubePhoneAccount(profile, body.action);
	return json({ accounts: youtubePhoneAccounts() });
};
