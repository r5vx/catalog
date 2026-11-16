import { error } from '@sveltejs/kit';
import { cloudPicture } from '$lib/server/online';
import { currentProfile } from '$lib/server/profile';
import type { RequestHandler } from './$types';

/**
 * Someone's profile banner (the picture across the top of their profile, src/routes/friends/[id]),
 * fetched from the meeting point as the profile looking. `?v=<number>` changes with each new one.
 */
export const GET: RequestHandler = async ({ params }) => {
	const picture = await cloudPicture(params.id, 'banner', currentProfile());
	if (!picture) error(404, 'No banner');
	return new Response(picture.bytes, {
		headers: { 'Content-Type': picture.type, 'Cache-Control': 'private, max-age=604800', 'X-Content-Type-Options': 'nosniff' }
	});
};
