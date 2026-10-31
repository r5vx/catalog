import { json, error } from '@sveltejs/kit';
import { findRokus, installOnRoku, isHomeAddress, rokuInfo } from '$lib/server/rokuInstall';
import { onThisComputer } from '$lib/server/profile';
import type { RequestHandler } from './$types';

/**
 * Settings → TV's "Install on Roku" (src/lib/server/rokuInstall.ts), from the computer Catalog runs on only.
 * GET: the Rokus on the home network; GET ?address=: that one Roku (typed in when the search misses it).
 * POST { address, password }: installs Catalog on it (the password is used once, never kept).
 */
function fromComputer(request: Request, getClientAddress: () => string) {
	let address = '';
	try {
		address = getClientAddress();
	} catch {}
	if (!onThisComputer(request.headers, address)) error(403, 'Only from the computer Catalog runs on');
}

const allowed = (address: string) => isHomeAddress(address) || (Boolean(process.env.CATALOG_ROKU_TEST_PORT) && address === '127.0.0.1');

export const GET: RequestHandler = async ({ request, getClientAddress, url }) => {
	fromComputer(request, getClientAddress);
	const address = url.searchParams.get('address')?.trim();
	if (address) {
		if (!allowed(address)) return error(400, "That isn't an address on this home network.");
		const roku = await rokuInfo(address);
		return json({ rokus: roku ? [roku] : [] });
	}
	return json({ rokus: await findRokus() });
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	fromComputer(request, getClientAddress);
	const body = (await request.json().catch(() => ({}))) as { address?: string; password?: string };
	const address = String(body.address ?? '').trim();
	const password = String(body.password ?? '');
	if (!allowed(address)) return error(400, "That isn't an address on this home network.");
	if (!password) return error(400, "The Roku's developer password is needed.");
	return json(await installOnRoku(address, password));
};
