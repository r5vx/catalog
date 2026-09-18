import { json, error } from '@sveltejs/kit';
import {
	searchShowbox,
	getFebboxLink,
	extractShareKey,
	listEpisodes,
	findMovieFile,
	getStreamUrl,
	bestMatch
} from '$lib/server/showbox';
import { readSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim();
	const type = url.searchParams.get('type') ?? '';
	const year = url.searchParams.get('year') ?? '';

	if (!title) return error(400, 'Missing title');

	const results = await searchShowbox(title);
	if (!results.length) return json({ error: 'not_found' });

	const match = bestMatch(results, title, type, year);
	if (!match) return json({ error: 'not_found' });

	const link = await getFebboxLink(match.id, match.type);
	if (!link) return json({ error: 'no_link' });

	const shareKey = extractShareKey(link);
	if (!shareKey) return json({ error: 'no_link' });

	const { febboxToken } = readSettings();

	if (match.type === 'tv') {
		const episodeData = await listEpisodes(link);
		const firstEp = episodeData.episodes[0];
		let streamUrl = '';

		if (firstEp && febboxToken) {
			streamUrl = (await getStreamUrl(shareKey, firstEp.fid, febboxToken)) ?? '';
		}

		return json({
			title: match.title,
			showboxId: match.id,
			type: match.type,
			shareKey,
			streamUrl,
			fid: firstEp?.fid ?? 0,
			hasToken: Boolean(febboxToken),
			episodes: episodeData
		});
	}

	const file = await findMovieFile(link);
	if (!file) return json({ error: 'no_file' });

	let streamUrl = '';
	if (febboxToken) {
		streamUrl = (await getStreamUrl(shareKey, file.fid, febboxToken)) ?? '';
	}

	return json({
		title: match.title,
		showboxId: match.id,
		type: match.type,
		shareKey,
		streamUrl,
		fid: file.fid,
		hasToken: Boolean(febboxToken)
	});
};
