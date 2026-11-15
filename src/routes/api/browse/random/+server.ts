import { json } from '@sveltejs/kit';
import { randomPick } from '$lib/server/metadata/tmdb';
import { existingSourceKeysWithIds } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

/** Browse → Random: one well-known film, series or anime (?kind=movies|tv|anime, ?genre=), not one in the library. */
export const GET: RequestHandler = async ({ url }) => {
	const asked = url.searchParams.get('kind');
	const kind = asked === 'tv' || asked === 'anime' ? asked : 'movies';
	const genre = Number(url.searchParams.get('genre')) || undefined;
	const pick = await randomPick(kind, genre, new Set(Object.keys(existingSourceKeysWithIds())));
	return json({ pick });
};
