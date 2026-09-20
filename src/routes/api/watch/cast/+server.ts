import { json, error, type RequestHandler } from '@sveltejs/kit';
import { fetchCast } from '$lib/server/metadata/tmdb';

export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim();
	const type = (url.searchParams.get('type') ?? 'movie') as 'movie' | 'tv';

	if (!title) return error(400, 'Missing title');

	const cast = await fetchCast(title, type);
	return json(cast);
};
