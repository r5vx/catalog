import { json, error } from '@sveltejs/kit';
import { getStreamUrl } from '$lib/server/showbox';
import { readSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const shareKey = url.searchParams.get('share_key');
	const fid = Number(url.searchParams.get('fid'));

	if (!shareKey || !fid) return error(400, 'Missing share_key or fid');

	const { febboxToken } = readSettings();
	if (!febboxToken) return json({ url: '' });

	const streamUrl = await getStreamUrl(shareKey, fid, febboxToken);
	return json({ url: streamUrl ?? '' });
};
