/**
 * Movies, TV Shows and Anime on the TVs (the Fire TV's /tv/browse and the Roku's
 * /api/roku/rows): what's yours of that kind, then trending, the biggest, and a row per genre.
 */
import { tvLibrary } from './db/queries';
import { browseShelves } from './metadata';

export const NAMES: Record<string, string> = { movies: 'Movies', tv: 'TV Shows', anime: 'Anime' };

/**
 * A row for each kind, under trending and the all-time biggest: TMDB's genres for films and TV
 * (TV has its own numbers for some; anime asks by the film numbers, src/lib/server/metadata/tmdb.ts
 * turns them into the series ones). Each row is its most popular.
 */
export const GENRES: Record<string, [number, string][]> = {
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

/** Yours of one kind (`cat`: movies, tv or anime), and the rows from TMDB/AniList (they take a moment). Null for another kind. */
export function browseFor(cat: string) {
	const name = NAMES[cat];
	if (!name) return null;
	const library = tvLibrary().filter((item) => item.category === cat);
	const byKind = Promise.all(
		GENRES[cat].map(([genre, label]) =>
			browseShelves(cat, 'popular', undefined, { genre, sort: 'popularity' })
				.then((shelves) => shelves.map((shelf) => ({ ...shelf, label })))
				.catch(() => [])
		)
	).then((rows) => rows.flat());
	return {
		name,
		library,
		shelves: Promise.all([browseShelves(cat, 'trending'), browseShelves(cat, 'popular'), byKind])
			.then((all) => all.flat())
			.catch(() => [])
	};
}
