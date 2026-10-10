import { searchAll, browseShelves, hasTmdbKey, trendingPeopleTmdb, type BrowseMode, type BrowseFilters } from '$lib/server/metadata';
import { existingSourceKeysWithIds, libraryPosters } from '$lib/server/db/queries';
import { searchPeople } from '$lib/server/db/people';
import { parseTitle } from '$lib/parseTitle';
import { watchRegion } from '$lib/server/metadata/providers';
import type { PageServerLoad } from './$types';

const CATEGORIES = ['movies', 'tv', 'anime'];
const VALID_SORTS = ['vote_count', 'vote_average', 'popularity', 'release_date_desc', 'release_date_asc'];

export const load: PageServerLoad = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	const cat = url.searchParams.get('cat') ?? '';
	const isActors = cat === 'actors';
	const category = CATEGORIES.includes(cat) ? cat : '';

	const mode: BrowseMode = url.searchParams.get('mode') === 'popular' ? 'popular' : 'trending';

	const region = watchRegion();

	const yearFrom = Number(url.searchParams.get('from')) || undefined;
	const yearTo = Number(url.searchParams.get('to')) || undefined;
	const sortRaw = url.searchParams.get('sort') ?? '';
	const sort = VALID_SORTS.includes(sortRaw) ? sortRaw as BrowseFilters['sort'] : undefined;
	const genre = Number(url.searchParams.get('genre')) || undefined;

	const filters: BrowseFilters | undefined =
		(yearFrom || yearTo || sort || genre) ? { yearFrom, yearTo, sort, genre } : undefined;

	if (isActors) {
		const people = q.length >= 2 ? searchPeople(q) : [];
		const trending = !q && hasTmdbKey() ? await trendingPeopleTmdb() : [];
		return {
			q,
			cat: 'actors',
			mode,
			yearFrom: yearFrom ?? null,
			yearTo: yearTo ?? null,
			sort: sort ?? null,
			genre: genre ?? null,
			results: [],
			shelves: [],
			owned: existingSourceKeysWithIds(),
			posters: libraryPosters(),
			tmdbEnabled: hasTmdbKey(),
			people,
			trending
		};
	}

	const { title, year } = parseTitle(q);

	const found = q ? await searchAll(title, { year, limit: 60, fuzzy: true }) : [];

	const results = category ? found.filter((one) => one.categorySlug === category) : found;

	const shelves = q ? [] : await browseShelves(category || undefined, mode, region, filters);

	return {
		q,
		cat: category,
		mode,
		yearFrom: yearFrom ?? null,
		yearTo: yearTo ?? null,
		sort: sort ?? null,
		genre: genre ?? null,
		results,
		shelves,
		owned: existingSourceKeysWithIds(),
		posters: libraryPosters(),
		tmdbEnabled: hasTmdbKey(),
		people: [],
		trending: []
	};
};
