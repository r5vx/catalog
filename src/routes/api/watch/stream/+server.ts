import { json, error } from '@sveltejs/kit';
import { getStreamUrl, invalidateStreamCache } from '$lib/server/showbox';
import { readSettings } from '$lib/server/settings';
import { aniwaveStream, parseAniwaveShareKey } from '$lib/server/sources/aniwave';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const shareKey = url.searchParams.get('share_key');
	const fid = Number(url.searchParams.get('fid'));
	const refresh = url.searchParams.get('refresh') === '1';

	if (!shareKey || !fid) return error(400, 'Missing share_key or fid');

	// Another source's file: its share key says which show, episode and version. Its video
	// comes through Catalog's relay, so it plays anywhere Catalog does (phone and TV too).
	const aniwave = parseAniwaveShareKey(shareKey);
	if (aniwave) {
		const stream = await aniwaveStream(aniwave.id, aniwave.episode, aniwave.kind, refresh);
		if (!stream) return json({ url: '', debug: 'Aniwave has no server for this version right now' });
		return json({ url: `/api/watch/relay?u=${encodeURIComponent(stream.url)}` });
	}

	const { febboxToken } = readSettings();
	if (!febboxToken) return json({ url: '' });

	if (refresh) invalidateStreamCache(fid);

	const result = await getStreamUrl(shareKey, fid, febboxToken);
	return json({ url: result.url ?? '', debug: result.debug });
};
