import { error } from '@sveltejs/kit';
import { browseFor } from '$lib/server/tvBrowse';
import type { PageServerLoad } from './$types';

/** Movies, TV Shows or Anime on the TV: yours first, then what's trending, the biggest, and by kind (src/lib/server/tvBrowse.ts). */
export const load: PageServerLoad = async ({ params }) => {
	const found = browseFor(params.cat);
	if (!found) error(404, 'Nothing here.');
	return found;
};
