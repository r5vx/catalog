import { json, error } from '@sveltejs/kit';
import { downloadSubtitle } from '$lib/server/showbox-subs';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const subUrl = url.searchParams.get('url');
	if (!subUrl) return error(400, 'Missing url');
	// Which episode to take out of a season-pack zip.
	const season = Number(url.searchParams.get('season')) || undefined;
	const episode = Number(url.searchParams.get('episode')) || undefined;

	const content = await downloadSubtitle(subUrl, season, episode);
	if (!content) return json({ content: '' });
	return json({ content });
};
