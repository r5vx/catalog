import { json, error } from '@sveltejs/kit';
import { phoneAddress, turnOnPhoneAddress } from '$lib/server/tailscale';
import { onThisComputer } from '$lib/server/profile';
import type { RequestHandler } from './$types';

/** The phone app's secure address (src/lib/server/tailscale.ts): GET how it stands, POST turns it on. */
export const GET: RequestHandler = async () => json(await phoneAddress());

/** Only from the computer Catalog runs on: it changes that computer's Tailscale. */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	let address = '';
	try {
		address = getClientAddress();
	} catch {}
	if (!onThisComputer(request.headers, address)) return error(403, 'Turn it on from the computer Catalog runs on');
	return json(await turnOnPhoneAddress());
};
