import { error } from '@sveltejs/kit';
import { soundOf } from '$lib/server/catasong/anime';

/**
 * A round's song, passed on from AnimeThemes so the page never sees its file name. Usually it was
 * downloaded ahead and comes from memory (catasong/anime.ts, "Rounds made ahead").
 */
export async function GET({ params }) {
	const sound = await soundOf(params.token);
	if (!sound) error(404, "That round is over, or its song didn't come.");
	return new Response(sound.bytes, {
		headers: { 'Content-Type': sound.type, 'Cache-Control': 'private, max-age=3600' }
	});
}
