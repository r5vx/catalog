import { json, error } from '@sveltejs/kit';
import { downloadSubtitle, isScrambled } from '$lib/server/showbox-subs';
import { forgetSubtitle, savedSubtitle, saveSubtitle } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

/**
 * Whether a download is really subtitles: SRT/VTT timings, ASS lines, or MicroDVD frames.
 * OpenSubtitles' download server answered with its own error page instead, as an ordinary
 * success ("Sorry. We have problem with network connection to database server", 2026-10-17):
 * that page was kept as Madagascar's subtitles, which then showed nothing — even once
 * OpenSubtitles was back.
 */
const isSubtitles = (text: string) => /-->|^\s*Dialogue:|^\s*\{\d+\}\{\d+\}/m.test(text);

/**
 * A subtitle file's text. Kept on this PC (for `show`) the first time, so it loads instantly
 * after that; kept copies go once the show is done with (forgetFinishedSubtitles).
 * `content` is empty when it couldn't be had — never something that isn't subtitles.
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
	if (kept && isSubtitles(kept) && !isScrambled(kept)) return json({ content: kept });
	// An error page (or a scrambled file) kept by mistake before: thrown away, and fetched again.
	if (kept) forgetSubtitle(key);

	const content = await downloadSubtitle(subUrl, season, episode);
	if (!content || !isSubtitles(content)) return json({ content: '' });
	if (show) saveSubtitle(key, show, content);
	return json({ content });
};
