import { json } from '@sveltejs/kit';
import { musicFor } from '$lib/server/metadata/music';
import type { RequestHandler } from './$types';

/**
 * A title's music, for the Music tab beside Cast (src/lib/server/metadata/music.ts):
 * ?source=tmdb&id=movie:27205&title=Inception&year=2010&type=movie&anime=0
 */
export const GET: RequestHandler = async ({ url }) => {
	const source = url.searchParams.get('source') ?? '';
	const sourceId = url.searchParams.get('id') ?? '';
	const title = (url.searchParams.get('title') ?? '').slice(0, 200);
	if (!/^(tmdb|anilist)$/.test(source) || !sourceId || !title) return json({ people: [], albums: [], themes: [] });
	const music = await musicFor({
		source,
		sourceId,
		title,
		year: (url.searchParams.get('year') ?? '').slice(0, 4),
		type: url.searchParams.get('type') === 'movie' ? 'movie' : 'tv',
		anime: url.searchParams.get('anime') === '1' || source === 'anilist'
	});
	return json(music);
};
