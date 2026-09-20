import { json, error } from '@sveltejs/kit';
import { downloadSubtitle } from '$lib/server/showbox-subs';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const subUrl = url.searchParams.get('url');
	if (!subUrl) return error(400, 'Missing url');

	const content = await downloadSubtitle(subUrl);
	if (!content) return json({ content: '' });
	return json({ content });
};
