import { json } from '@sveltejs/kit';
import { filesThatAreOnline, sharedFriendsWhoWatched } from '$lib/server/sharedSeen';
import type { RequestHandler } from './$types';

/**
 * The friends whose shared library file has this title as watched (a title's "watched this" line).
 * ?source=&id=&title=&year=, and &online=<ids> of friends online who watched it: a file that is one
 * of them under another name is left out.
 */
export const GET: RequestHandler = async ({ url }) => {
	const year = Number(url.searchParams.get('year')) || null;
	const found = sharedFriendsWhoWatched(url.searchParams.get('source') ?? '', url.searchParams.get('id') ?? '', url.searchParams.get('title') ?? '', year);
	const online = (url.searchParams.get('online') ?? '').split(',').filter(Boolean).slice(0, 20);
	const twins = await filesThatAreOnline(found.map((f) => f.id), online).catch(() => new Set<string>());
	return json({ friends: found.filter((f) => !twins.has(f.id)) });
};
