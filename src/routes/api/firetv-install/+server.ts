import { json, error } from '@sveltejs/kit';
import { findFireTvs, fireTvAt, startFireTvInstall, installJob } from '$lib/server/fireTvInstall';
import { isHomeAddress } from '$lib/server/rokuInstall';
import { onThisComputer } from '$lib/server/profile';
import type { RequestHandler } from './$types';

/** A home address, or this computer while a pretend TV stands in (CATALOG_FIRETV_TEST_PORT). */
const allowed = (address: string) => isHomeAddress(address) || (Boolean(process.env.CATALOG_FIRETV_TEST_PORT) && address === '127.0.0.1');

/**
 * Settings → TV and phones' "Install on Fire TV" (src/lib/server/fireTvInstall.ts), from the
 * computer Catalog runs on only.
 * GET: the Fire TVs found; GET ?address=: that one (typed in); GET ?job=: how an install is going.
 * POST { address }: starts installing the TV app on it (answers { job }).
 */
function fromComputer(request: Request, getClientAddress: () => string) {
	let address = '';
	try {
		address = getClientAddress();
	} catch {}
	if (!onThisComputer(request.headers, address)) error(403, 'Only from the computer Catalog runs on');
}

export const GET: RequestHandler = async ({ request, getClientAddress, url }) => {
	fromComputer(request, getClientAddress);
	const job = url.searchParams.get('job');
	if (job) {
		const found = installJob(job);
		return found ? json(found) : error(404, 'No such install');
	}
	const address = url.searchParams.get('address')?.trim();
	if (address) {
		if (!allowed(address)) return error(400, "That isn't an address on this home network.");
		return json({ tvs: [await fireTvAt(address)] });
	}
	return json({ tvs: await findFireTvs() });
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	fromComputer(request, getClientAddress);
	const body = (await request.json().catch(() => ({}))) as { address?: string };
	const address = String(body.address ?? '').trim();
	if (!allowed(address)) return error(400, "That isn't an address on this home network.");
	return json({ job: startFireTvInstall(address) });
};
