import { tvLibrary } from '$lib/server/db/queries';
import { continueWatchingWithPosters } from '$lib/server/continueWatching';
import { browseShelves } from '$lib/server/metadata';
import type { PageServerLoad } from './$types';

/**
 * The TV's home: what you're in the middle of, your lists, then what's popular. What's popular
 * comes from TMDB and AniList, so it follows when it's ready instead of holding the page up.
 */
export const load: PageServerLoad = async () => {
	const library = tvLibrary();
	return {
		continueWatching: await continueWatchingWithPosters(),
		library,
		shelves: browseShelves().catch(() => [])
	};
};
