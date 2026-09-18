import { json } from '@sveltejs/kit';
import { searchShowbox } from '$lib/server/showbox';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q')?.trim();
	if (!q) return json([]);

	const results = await searchShowbox(q);
	return json(results);
};
