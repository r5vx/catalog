import { fileResponse } from '$lib/server/torrents';
import type { RequestHandler } from './$types';

/**
 * One file of a torrent that's playing (Nyaa's copies, src/lib/server/sources/nyaa.ts), as a plain
 * video: the player's Range requests are answered as the pieces arrive (src/lib/server/torrents.ts).
 * Only torrents Catalog opened itself (their .torrent kept in %APPDATA%\Catalog\torrents).
 */
export const GET: RequestHandler = async ({ url, request }) => {
	const hash = url.searchParams.get('hash') ?? '';
	const file = Number(url.searchParams.get('file'));
	if (!/^[a-f0-9]{40}$/i.test(hash) || !Number.isInteger(file) || file < 0) return new Response('Bad request', { status: 400 });
	return fileResponse(hash, file, request.headers.get('range'));
};
