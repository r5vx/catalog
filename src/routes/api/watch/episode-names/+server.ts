import { json, error } from '@sveltejs/kit';
import { fetchEpisodeNames } from '$lib/server/metadata/tmdb';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim();
	const season = Number(url.searchParams.get('season'));

	if (!title || !season) return error(400, 'Missing title or season');

	const names = await fetchEpisodeNames(title, season);
	return json(names);
};
