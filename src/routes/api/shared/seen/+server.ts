import { json } from '@sveltejs/kit';
import { sharedFriendsWhoWatched } from '$lib/server/sharedSeen';
import type { RequestHandler } from './$types';

/** The friends whose shared library file has this title as watched (a title's "watched this" line). ?source=&id=&title=&year= */
export const GET: RequestHandler = ({ url }) => {
	const year = Number(url.searchParams.get('year')) || null;
	return json({
		friends: sharedFriendsWhoWatched(url.searchParams.get('source') ?? '', url.searchParams.get('id') ?? '', url.searchParams.get('title') ?? '', year)
	});
};
