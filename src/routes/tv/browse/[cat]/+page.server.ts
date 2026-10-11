import { error } from '@sveltejs/kit';
import { tvLibrary } from '$lib/server/db/queries';
import { browseShelves } from '$lib/server/metadata';
import type { PageServerLoad } from './$types';

const NAMES: Record<string, string> = { movies: 'Movies', tv: 'TV Shows', anime: 'Anime' };

/**
 * A row for each kind, under trending and the all-time biggest: TMDB's genres for films and TV
 * (TV has its own numbers for some), AniList's for anime (fewer rows: AniList allows only a few
 * requests a minute). Each row is its most popular.
 */
const GENRES: Record<string, [number, string][]> = {
	movies: [
		[35, 'Comedy'],
		[28, 'Action'],
		[18, 'Drama'],
		[10749, 'Romance'],
		[53, 'Thriller'],
		[27, 'Horror'],
		[878, 'Sci-Fi'],
		[10751, 'Family'],
		[16, 'Animation'],
		[80, 'Crime'],
		[9648, 'Mystery'],
		[14, 'Fantasy'],
		[12, 'Adventure'],
		[99, 'Documentary']
	],
	tv: [
		[35, 'Comedy'],
		[18, 'Drama'],
		[80, 'Crime'],
		[10759, 'Action & Adventure'],
		[9648, 'Mystery'],
		[10765, 'Sci-Fi & Fantasy'],
		[10751, 'Family'],
		[16, 'Animation'],
		[10764, 'Reality'],
		[99, 'Documentary']
	],
	anime: [
		[28, 'Action'],
		[35, 'Comedy'],
		[10749, 'Romance'],
		[14, 'Fantasy'],
		[18, 'Drama'],
		[9648, 'Mystery'],
		[878, 'Sci-Fi'],
		[27, 'Horror']
	]
};

/** Movies, TV Shows or Anime on the TV: yours first, then what's trending, the biggest, and by kind. */
export const load: PageServerLoad = async ({ params }) => {
	const name = NAMES[params.cat];
	if (!name) error(404, 'Nothing here.');
	const library = tvLibrary().filter((item) => item.category === params.cat);
	const byKind = Promise.all(
		GENRES[params.cat].map(([genre, label]) =>
			browseShelves(params.cat, 'popular', undefined, { genre, sort: 'popularity' })
				.then((shelves) => shelves.map((shelf) => ({ ...shelf, label })))
				.catch(() => [])
		)
	).then((rows) => rows.flat());
	return {
		name,
		library,
		shelves: Promise.all([browseShelves(params.cat, 'trending'), browseShelves(params.cat, 'popular'), byKind])
			.then((all) => all.flat())
			.catch(() => [])
	};
};
