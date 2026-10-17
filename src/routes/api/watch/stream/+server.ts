import { json, error } from '@sveltejs/kit';
import { getStreamUrl, invalidateStreamCache } from '$lib/server/showbox';
import { readSettings } from '$lib/server/settings';
import { aniwaveStream, parseAniwaveShareKey } from '$lib/server/sources/aniwave';
import { vidriftStream, parseVidriftShareKey } from '$lib/server/sources/vidrift';
import { movyStream, parseMovyShareKey } from '$lib/server/sources/movy';
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

	// 7Movies: its playlist comes through the relay too (the video pieces mostly don't).
	if (parseVidriftShareKey(shareKey)) {
		const playlist = await vidriftStream(shareKey, refresh);
		if (!playlist) return json({ url: '', debug: '7Movies has nothing for this right now' });
		return json({ url: `/api/watch/relay?u=${encodeURIComponent(playlist)}` });
	}

	// Movy: found by its own page, out of sight (sources/movy.ts); played through the relay.
	if (parseMovyShareKey(shareKey)) {
		const playlist = await movyStream(shareKey, refresh);
		if (!playlist) return json({ url: '', debug: 'Movy has nothing for this right now' });
		return json({ url: `/api/watch/relay?u=${encodeURIComponent(playlist)}` });
	}

	const { febboxToken } = readSettings();
	if (!febboxToken) return json({ url: '' });

	if (refresh) invalidateStreamCache(fid);

	const result = await getStreamUrl(shareKey, fid, febboxToken);
	return json({ url: result.url ?? '', debug: result.debug });
};
