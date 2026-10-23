import { json } from '@sveltejs/kit';
import { febboxFlow } from '$lib/server/febboxFlow';
import type { RequestHandler } from './$types';

/** How much of Febbox's daily fast video is used (src/lib/server/febboxFlow.ts); null if not known. */
export const GET: RequestHandler = async () => json(await febboxFlow());
