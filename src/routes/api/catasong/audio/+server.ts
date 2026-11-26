import { error } from '@sveltejs/kit';
import { endlessPreview, isGenre, previewOf } from '$lib/server/catasong/daily';

/**
 * Today's song for ?genre=, or an Endless round's for ?token=, passed on from Deezer so the page
 * never sees which song it is.
 */
export async function GET({ url }) {
	const token = url.searchParams.get('token');
	const genre = url.searchParams.get('genre');
	let address: string | null = null;
	if (token) address = await endlessPreview(token);
	else if (isGenre(genre)) address = await previewOf(genre);
	else error(400, 'Unknown genre.');
	if (!address) error(404, 'No song.');
	const answer = await fetch(address, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
	if (!answer?.ok || !answer.body) error(502, "The song didn't come.");
	return new Response(answer.body, {
		headers: { 'Content-Type': answer.headers.get('Content-Type') ?? 'audio/mpeg', 'Cache-Control': 'no-store' }
	});
}
