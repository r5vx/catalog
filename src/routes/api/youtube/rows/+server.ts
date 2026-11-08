import { json, error } from '@sveltejs/kit';
import { youtubeRows } from '$lib/server/youtubeTv';
import type { RequestHandler } from './$types';

/** YouTube's rows for the Roku's YouTube screen (src/lib/server/youtubeTv.ts): a place, a channel or a playlist. */
export const GET: RequestHandler = async ({ url }) => {
	const place = url.searchParams.get('place') ?? '';
	const id = url.searchParams.get('id') ?? '';
	const rows = await youtubeRows(place, id).catch(() => null);
	if (!rows) return error(502, "YouTube didn't answer");
	// (`asked`: the Roku drops an answer for a place it has since left.)
	return json({ rows, asked: `${place}|${id}` });
};
