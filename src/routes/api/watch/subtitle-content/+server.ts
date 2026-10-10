import { json, error } from '@sveltejs/kit';
import { downloadSubtitle } from '$lib/server/showbox-subs';
import { savedSubtitle, saveSubtitle } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

/**
 * A subtitle file's text. Kept on this PC (for `show`) the first time, so it loads instantly
 * after that; kept copies go once the show is done with (forgetFinishedSubtitles).
 */
export const GET: RequestHandler = async ({ url }) => {
	const subUrl = url.searchParams.get('url');
	if (!subUrl) return error(400, 'Missing url');
	// Which episode to take out of a season-pack zip.
	const season = Number(url.searchParams.get('season')) || undefined;
	const episode = Number(url.searchParams.get('episode')) || undefined;
	const show = url.searchParams.get('show')?.trim();

	// A season pack holds every episode, so its copy is only reused for the same episode.
	const key = season && episode ? `${subUrl}#${season}x${episode}` : subUrl;
	const kept = savedSubtitle(key);
	if (kept) return json({ content: kept });

	const content = await downloadSubtitle(subUrl, season, episode);
	if (!content) return json({ content: '' });
	if (show) saveSubtitle(key, show, content);
	return json({ content });
};
