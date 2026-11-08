import { json, error } from '@sveltejs/kit';
import { episodeRatings } from '$lib/server/episodeRatings';
import type { RequestHandler } from './$types';

/** A show's ratings by episode, for the chart on its page. ?source=tmdb|anilist&id=&title= (as /api/episodes). */
export const GET: RequestHandler = async ({ url }) => {
	const source = url.searchParams.get('source') ?? '';
	const id = url.searchParams.get('id') ?? '';
	const title = url.searchParams.get('title') ?? '';
	if ((source !== 'tmdb' && source !== 'anilist') || !id || !title) error(400, 'Which show?');
	return json(await episodeRatings(source, id, title).catch(() => null));
};
