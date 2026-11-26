import { json } from '@sveltejs/kit';
import { getOrderCache } from '$lib/server/db/queries';
import { fetchDetails, type TitleDetails } from '$lib/server/metadata/details';
import type { RequestHandler } from './$types';

/**
 * Trailer and movie release date for library entries. Uses the saved title details when present.
 */
export const GET: RequestHandler = async ({ url }) => {
	const source = url.searchParams.get('source') ?? '';
	const id = url.searchParams.get('id') ?? '';
	if (!(source === 'tmdb' && /^(movie|tv):\d+$/.test(id)) && !(source === 'anilist' && /^\d+$/.test(id))) return json({ releaseDate: null, trailerKey: null });
	const kept = getOrderCache(`details|${source}|${id}`)?.value as TitleDetails | undefined;
	const details = kept ?? await fetchDetails(source, id).catch(() => null);
	return json({ releaseDate: id.startsWith('movie:') ? details?.releaseDate ?? null : null, trailerKey: details?.trailerKey ?? null });
};
