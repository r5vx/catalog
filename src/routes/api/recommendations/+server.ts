import { json } from '@sveltejs/kit';
import { moreLikeThis } from '$lib/server/recommendations';
import type { RequestHandler } from './$types';

/** "More like this" for one title: ?source=tmdb|anilist&id=movie:157336|21[&title=]. */
export const GET: RequestHandler = async ({ url }) => {
	const source = url.searchParams.get('source') ?? '';
	const id = url.searchParams.get('id') ?? '';
	if ((source !== 'tmdb' && source !== 'anilist') || !id) return json([]);
	return json(await moreLikeThis(source, id, url.searchParams.get('title') ?? ''));
};
