import { json } from '@sveltejs/kit';
import { febboxFlowAll } from '$lib/server/febboxAccounts';
import type { RequestHandler } from './$types';

/**
 * How much of Febbox's daily fast video is used (src/lib/server/febboxFlow.ts), across every
 * account signed in (febboxAccounts.ts); null if not known. With the accounts it's for
 * (`account`), as the player keeps "used up" per sign-in.
 */
export const GET: RequestHandler = async () => json(await febboxFlowAll());
