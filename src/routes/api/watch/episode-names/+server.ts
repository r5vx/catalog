import { json, error } from '@sveltejs/kit';
import { fetchEpisodeNames } from '$lib/server/metadata/tmdb';
import { tmdbShow } from '$lib/server/combinedEpisodes';
import type { RequestHandler } from './$types';

/**
 * Episode names for one season of the player's list. When Showbox splits a show into seasons
 * TMDB doesn't have (Re:Zero: TMDB has one season of 85), `before` — how many episodes come
 * before this season — finds them by counting into TMDB's seasons instead.
 */
export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim();
	const season = Number(url.searchParams.get('season'));
	const before = Number(url.searchParams.get('before')) || 0;
	const count = Number(url.searchParams.get('count')) || 0;

	if (!title || !season) return error(400, 'Missing title or season');

	const names = await fetchEpisodeNames(title, season);
	if (Object.keys(names).length || !before || !count) return json(names);

	const show = await tmdbShow(title, '');
	if (!show) return json(names);
	// Walk TMDB's seasons, counting episodes from the first, and take this season's stretch.
	let passed = 0;
	for (const s of show.seasons.filter((s) => s.number > 0).sort((a, b) => a.number - b.number)) {
		const from = passed;
		passed += s.count;
		if (passed <= before || from >= before + count) continue;
		const theirs = await fetchEpisodeNames(title, s.number);
		for (const [number, name] of Object.entries(theirs)) {
			const ours = from + Number(number) - before;
			if (ours >= 1 && ours <= count) names[ours] = name;
		}
	}
	return json(names);
};
