import { json } from '@sveltejs/kit';
import { browsePage, BROWSE_CATEGORIES, type BrowseMode, type BrowseFilters } from '$lib/server/metadata';
import { existingSourceKeysWithIds } from '$lib/server/db/queries';
import { watchRegion } from '$lib/server/metadata/providers';
import type { RequestHandler } from './$types';

const VALID_SORTS = ['vote_count', 'vote_average', 'popularity', 'release_date_desc', 'release_date_asc'];

export const GET: RequestHandler = async ({ url }) => {
	const category = url.searchParams.get('cat') ?? '';
	const mode: BrowseMode = url.searchParams.get('mode') === 'popular' ? 'popular' : 'trending';
	const page = Math.min(Math.max(Number(url.searchParams.get('page')) || 1, 1), 500);

	if (!BROWSE_CATEGORIES.includes(category as (typeof BROWSE_CATEGORIES)[number])) {
		return json({ results: [], page, owned: [] });
	}

	const yearFrom = Number(url.searchParams.get('from')) || undefined;
	const yearTo = Number(url.searchParams.get('to')) || undefined;
	const sortRaw = url.searchParams.get('sort') ?? '';
	const sort = VALID_SORTS.includes(sortRaw) ? sortRaw as BrowseFilters['sort'] : undefined;
	const genre = Number(url.searchParams.get('genre')) || undefined;
	const filters: BrowseFilters | undefined =
		(yearFrom || yearTo || sort || genre) ? { yearFrom, yearTo, sort, genre } : undefined;

	return json({
		results: await browsePage(category, mode, page, watchRegion(), filters),
		page,
		owned: existingSourceKeysWithIds()
	});
};
