import { json, error } from '@sveltejs/kit';
import { streamLink } from '$lib/server/streamLink';
import { electronCloseTurnstile } from '$lib/server/electron-fetch';
import type { RequestHandler } from './$types';

/** A copy's playlist address (?share_key=&fid=, &refresh=1 for a new one): see streamLink.ts. */
export const GET: RequestHandler = async ({ url, request }) => {
	const shareKey = url.searchParams.get('share_key');
	const fid = Number(url.searchParams.get('fid'));
	const refresh = url.searchParams.get('refresh') === '1';
	// The computer's own player (streamLink.ts): Showbox downloaded ahead when there's room.
	const ahead = url.searchParams.get('ahead') === '1';

	if (!shareKey || !fid) return error(400, 'Missing share_key or fid');
	if (shareKey.startsWith('allanime:')) {
		request.signal.addEventListener('abort', () => electronCloseTurnstile(), { once: true });
	}
	return json(await streamLink(shareKey, fid, refresh, ahead));
};

/** Explicitly close any open AllAnime verification window when the player navigates back. */
export const DELETE: RequestHandler = async () => {
	electronCloseTurnstile();
	return new Response(null, { status: 204 });
};
