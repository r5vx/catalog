import { cloudPicture } from '$lib/server/online';
import type { RequestHandler } from './$types';

/**
 * Someone's picture online (Settings → Online), fetched from the meeting point with this
 * computer's key and handed to the page as the image. The address carries `?v=<number>`, which
 * changes with each new picture, so the browser can keep one for a long time.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const picture = await cloudPicture(params.id, 'avatar', 0, url.searchParams.get('v') ?? '');
	// (Not kept by the browser: it may only be the server not answering this once.)
	if (!picture) return new Response('No picture', { status: 404, headers: { 'Cache-Control': 'no-store' } });
	return new Response(picture.bytes, {
		headers: { 'Content-Type': picture.type, 'Cache-Control': 'private, max-age=604800', 'X-Content-Type-Options': 'nosniff' }
	});
};
