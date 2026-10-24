import { json } from '@sveltejs/kit';
import { febboxFlow } from '$lib/server/febboxFlow';
import { febboxAccountOf, readSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

/**
 * How much of Febbox's daily fast video is used (src/lib/server/febboxFlow.ts); null if not known.
 * With the account it's for (`account`), as the player keeps "used up" per account.
 */
export const GET: RequestHandler = async () => {
	const flow = await febboxFlow();
	return json(flow && { ...flow, account: febboxAccountOf(readSettings().febboxToken) });
};
