import { json, error } from '@sveltejs/kit';
import { seasonEpisodes } from '$lib/server/tvEpisodes';
import { watchedEpisodesForTitle } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

/**
 * One season's episodes for the TV's title screen, with how far through each one whoever's
 * watching is. ?show=<TMDB id>&season=<n>&title=<the name it plays under>
 */
export const GET: RequestHandler = async ({ url }) => {
	const show = Number(url.searchParams.get('show'));
	const season = Number(url.searchParams.get('season'));
	const title = url.searchParams.get('title') ?? '';
	if (!show || !season) error(400, 'Which season?');

	const episodes = await seasonEpisodes(show, season);
	const watched = title ? watchedEpisodesForTitle(title).filter((w) => w.season === season) : [];
	const progress = Object.fromEntries(watched.map((w) => [w.episode, Math.min(1, w.pct)]));
	return json({ episodes: episodes.map((e) => ({ ...e, progress: progress[e.episode] ?? 0 })) });
};
