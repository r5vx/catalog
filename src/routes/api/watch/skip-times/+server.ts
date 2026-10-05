import { json, error } from '@sveltejs/kit';
import { skipTimesFor } from '$lib/server/metadata/skiptimes';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim();
	const episode = Number(url.searchParams.get('episode'));
	const duration = Number(url.searchParams.get('duration'));

	if (!title || !Number.isInteger(episode) || episode < 1 || !(duration > 60)) {
		return error(400, 'Missing title, episode or duration');
	}

	return json(await skipTimesFor(title, episode, duration));
};
