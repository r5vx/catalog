import { json, error } from '@sveltejs/kit';
import {
	searchShowbox,
	getFebboxLink,
	extractShareKey,
	listEpisodes,
	listMovieFiles,
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
		const firstFile = firstEp?.files[0];
		let streamUrl = '';
		let streamDebug: string | undefined;

		if (firstFile && febboxToken) {
			const result = await getStreamUrl(shareKey, firstFile.fid, febboxToken);
			streamUrl = result.url ?? '';
			streamDebug = result.debug;
		}

		return json({
			title: match.title,
			showboxId: match.id,
			type: match.type,
			shareKey,
			streamUrl,
			fid: firstFile?.fid ?? 0,
			hasToken: Boolean(febboxToken),
			episodes: episodeData,
			debug: streamDebug
		});
	}

	const files = await listMovieFiles(link);
	if (!files.length) return json({ error: 'no_file' });

	const defaultFile =
		files.find((f) => f.quality === '1080p') ??
		files.find((f) => f.quality === '720p') ??
		files[0];

	let streamUrl = '';
	let streamDebug: string | undefined;
	if (febboxToken) {
		const result = await getStreamUrl(shareKey, defaultFile.fid, febboxToken);
		streamUrl = result.url ?? '';
		streamDebug = result.debug;
	}

	return json({
		title: match.title,
		showboxId: match.id,
		type: match.type,
		shareKey,
		streamUrl,
		fid: defaultFile.fid,
		hasToken: Boolean(febboxToken),
		files,
		debug: streamDebug
	});
};
