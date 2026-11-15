import { json } from '@sveltejs/kit';
import { gameRoles } from '$lib/server/metadata/gameRoles';
import type { RequestHandler } from './$types';

/** The games someone voiced (?id=tmdb:963818 or anilist:95054), from Wikidata: { games }. */
export const GET: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('id') ?? '';
	return json({ games: await gameRoles(id) });
};
