import { json, error, type RequestHandler } from '@sveltejs/kit';
import { fetchCast, fetchEpisodeCast } from '$lib/server/metadata/tmdb';

export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim();
	const type = (url.searchParams.get('type') ?? 'movie') as 'movie' | 'tv';
	const season = Number(url.searchParams.get('season') ?? 0);
	const episode = Number(url.searchParams.get('episode') ?? 0);

	if (!title) return error(400, 'Missing title');

	const cast = type === 'tv' && season > 0 && episode > 0
		? await fetchEpisodeCast(title, season, episode)
		: await fetchCast(title, type);
	return json(cast);
};
