import { error } from '@sveltejs/kit';
import { cloudPicture } from '$lib/server/online';
import type { RequestHandler } from './$types';

/**
 * Someone's picture online (Settings → Online), fetched from the meeting point with this
 * computer's key and handed to the page as the image. The address carries `?v=<number>`, which
 * changes with each new picture, so the browser can keep one for a long time.
 */
export const GET: RequestHandler = async ({ params }) => {
	const picture = await cloudPicture(params.id);
	if (!picture) error(404, 'No picture');
	return new Response(picture.bytes, {
		headers: { 'Content-Type': picture.type, 'Cache-Control': 'private, max-age=604800', 'X-Content-Type-Options': 'nosniff' }
	});
};
