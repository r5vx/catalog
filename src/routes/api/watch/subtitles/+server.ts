import { json, error } from '@sveltejs/kit';
import { fetchSubtitlesForTitle } from '$lib/server/showbox-subs';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim();
	const type = (url.searchParams.get('type') ?? 'movie') as 'movie' | 'tv';
	const season = Number(url.searchParams.get('season') ?? 0) || undefined;
	const episode = Number(url.searchParams.get('episode') ?? 0) || undefined;

	if (!title) return error(400, 'Missing title');

	const subs = await fetchSubtitlesForTitle(title, type, season, episode);
	return json(subs);
};
