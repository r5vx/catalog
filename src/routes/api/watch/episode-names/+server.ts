import { json, error } from '@sveltejs/kit';
import { fetchEpisodeNames } from '$lib/server/metadata/tmdb';
import { tmdbShow } from '$lib/server/combinedEpisodes';
import { episodesBefore } from '$lib/server/sources';
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

	if (!before || !count) return json(await fetchEpisodeNames(title, season));

	// TMDB's season of the same number is only this one when it starts at the same episode:
	// Black Clover's Showbox season 2 is episodes 52–102, TMDB's season 2 is the 2026 one.
	const show = await tmdbShow(title, '');
	const same = !show || (show.seasons.some((s) => s.number === season) && episodesBefore(show, season) === before);
	const names: Record<number, string> = same ? await fetchEpisodeNames(title, season) : {};
	if (!show || Object.keys(names).length) return json(names);
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
