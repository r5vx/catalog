import { listCategories, listEntries, countsByCategory, completedCount, completedByCategory, continueWatchingList, sharedCatalogCount, existingSourceKeys, existingSourceKeysWithIds } from '$lib/server/db/queries';
import { countNotes } from '$lib/server/db/notes';
import { listTags } from '$lib/server/db/tags';
import { SORTS } from '$lib/constants';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	const cat = url.searchParams.get('cat') ?? '';
	const status = url.searchParams.get('status') ?? '';
	const sortKey = url.searchParams.get('sort') ?? 'recent';
	const tagIds = url.searchParams
		.getAll('tag')
		.map((value) => Number(value))
		.filter((value) => Number.isFinite(value) && value > 0);
	const yearFrom = Number(url.searchParams.get('yearFrom')) || null;
	const yearTo = Number(url.searchParams.get('yearTo')) || null;

	const sort = SORTS.find((s) => s.value === sortKey) ?? SORTS[0];

	const categories = listCategories();
	const activeCategory = categories.find((c) => c.slug === cat);

	const entries = listEntries({
		search: q,
		categoryId: activeCategory?.id ?? null,
		status,
		tagIds,
		yearFrom,
		yearTo,
		sortColumn: sort.column,
		sortDir: sort.dir
	});

	const countByCategory = countsByCategory();
	const total = Object.values(countByCategory).reduce((sum, n) => sum + n, 0);

	return {
		entries,
		categories,
		countByCategory,
		total,
		completed: completedCount(),
		completedByCategory: completedByCategory(),
		noteCount: countNotes(),
		tags: listTags(),
		filters: { q, cat, status, sort: sort.value, tags: tagIds, yearFrom, yearTo },
		continueWatching: continueWatchingList(),
		friendCount: sharedCatalogCount(),
		ownedKeys: [...existingSourceKeys()],
		ownedMap: existingSourceKeysWithIds()
	};
};
