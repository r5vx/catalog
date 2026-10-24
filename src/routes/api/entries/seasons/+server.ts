import { json, error } from '@sveltejs/kit';
import { getEntry } from '$lib/server/db/queries';
import { seasonsOf } from '$lib/server/metadata/seasons';
import type { RequestHandler } from './$types';

/** An entry's seasons and how many episodes each has (null when not known): ?id= */
export const GET: RequestHandler = async ({ url }) => {
	const entry = getEntry(Number(url.searchParams.get('id')));
	if (!entry) return error(404, 'No such entry');
	return json(await seasonsOf(entry.source, entry.sourceId, entry.episodesTotal));
};
