import { json, error } from '@sveltejs/kit';
import { searchYouTube } from '$lib/server/youtube';
import type { RequestHandler } from './$types';

/** YouTube search for the Roku's YouTube screen and the computer's test page (src/lib/server/youtube.ts). */
export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q')?.trim() ?? '';
	if (q.length < 2) return error(400, 'Missing q');
	const results = await searchYouTube(q).catch(() => null);
	if (!results) return error(502, "YouTube didn't answer");
	return json({ results });
};
