import { json, error } from '@sveltejs/kit';
import { getFebboxLink } from '$lib/server/showbox';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const id = Number(url.searchParams.get('id'));
	const type = url.searchParams.get('type');

	if (!id || (type !== 'movie' && type !== 'tv')) {
		return error(400, 'Missing id or type');
	}

	const link = await getFebboxLink(id, type);
	if (!link) return error(502, 'No link available');

	return json({ link });
};
