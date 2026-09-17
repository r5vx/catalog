import { searchAll, browseShelves, hasTmdbKey, type BrowseMode } from '$lib/server/metadata';
import { existingSourceKeys } from '$lib/server/db/queries';
import { parseTitle } from '$lib/parseTitle';
import type { PageServerLoad } from './$types';

/**
 * Everything, rather than only what you own.
 *
 * The library answers "what have I seen"; this answers "what is there". Same
 * databases the rest of the app uses, no filter on whether it's yours — so
 * you can read what something is about before deciding it's worth an evening.
 */

const CATEGORIES = ['movies', 'tv', 'anime'];

export const load: PageServerLoad = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	const cat = url.searchParams.get('cat') ?? '';
	const category = CATEGORIES.includes(cat) ? cat : '';

	// What's on this week, or what has been biggest ever. Different questions,
	// and which one you want depends on whether you've already seen this year.
	const mode: BrowseMode = url.searchParams.get('mode') === 'popular' ? 'popular' : 'trending';

	// "Fantastic Four (2005)" should work here exactly as it does in the
	// importer and the add box.
	const { title, year } = parseTitle(q);

	// A wider net than the add box: browsing is the case where the thing you
	// want is the twentieth result, not the first.
	const found = q ? await searchAll(title, { year, limit: 60 }) : [];

	const results = category ? found.filter((one) => one.categorySlug === category) : found;

	return {
		q,
		cat: category,
		mode,
		results,
		// Only asked for when there's nothing to search, so a search doesn't
		// wait on three lists it won't show.
		shelves: q ? [] : await browseShelves(category || undefined, mode),
		// Marks what's already yours, so browsing doesn't offer you your own
		// library back.
		owned: [...existingSourceKeys()],
		tmdbEnabled: hasTmdbKey()
	};
};
