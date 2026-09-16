import { json } from '@sveltejs/kit';
import { startBackfill, backfillState, missingCount } from '$lib/server/backfill';
import type { RequestHandler } from './$types';

/** Where Settings polls while the library is being filled in. */
export const GET: RequestHandler = async () =>
	json({ state: backfillState(), missing: missingCount() });

export const POST: RequestHandler = async () => {
	startBackfill();
	return json({ started: true });
};
