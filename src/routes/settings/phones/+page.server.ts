import { phoneAddress } from '$lib/server/tailscale';
import { onThisComputer } from '$lib/server/profile';
import type { PageServerLoad } from './$types';

/** The phone app's address, and whether this page is open on the computer Catalog runs on. */
export const load: PageServerLoad = async ({ request, getClientAddress }) => {
	let client = '';
	try {
		client = getClientAddress();
	} catch {}
	return { phone: await phoneAddress(), onComputer: onThisComputer(request.headers, client) };
};
