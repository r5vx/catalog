import { json } from '@sveltejs/kit';
import { ALL_SOURCES } from '$lib/sourceList';
import { sourceReachable } from '$lib/server/reachable';
import type { RequestHandler } from './$types';

/** { name: true } when the site answers at all (kept two minutes per site in reachable.ts). */
export const GET: RequestHandler = async () => {
	const answers = await Promise.all(ALL_SOURCES.map(async (s) => [s.name, await sourceReachable(s.name)] as const));
	return json(Object.fromEntries(answers), { headers: { 'cache-control': 'no-store' } });
};
