import { json, error } from '@sveltejs/kit';
import { streamLink } from '$lib/server/streamLink';
import type { RequestHandler } from './$types';

/** A copy's playlist address (?share_key=&fid=, &refresh=1 for a new one): see streamLink.ts. */
export const GET: RequestHandler = async ({ url }) => {
	const shareKey = url.searchParams.get('share_key');
	const fid = Number(url.searchParams.get('fid'));
	const refresh = url.searchParams.get('refresh') === '1';

	if (!shareKey || !fid) return error(400, 'Missing share_key or fid');
	return json(await streamLink(shareKey, fid, refresh));
};
