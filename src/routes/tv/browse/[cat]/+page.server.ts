import { error } from '@sveltejs/kit';
import { tvLibrary } from '$lib/server/db/queries';
import { browseShelves } from '$lib/server/metadata';
import type { PageServerLoad } from './$types';

const NAMES: Record<string, string> = { movies: 'Movies', tv: 'TV Shows', anime: 'Anime' };

/** Movies, TV Shows or Anime on the TV: yours first, then what's trending and the all-time biggest. */
export const load: PageServerLoad = async ({ params }) => {
	const name = NAMES[params.cat];
	if (!name) error(404, 'Nothing here.');
	const library = tvLibrary().filter((item) => item.category === params.cat);
	return {
		name,
		library,
		shelves: Promise.all([browseShelves(params.cat, 'trending'), browseShelves(params.cat, 'popular')])
			.then((both) => both.flat())
			.catch(() => [])
	};
};
