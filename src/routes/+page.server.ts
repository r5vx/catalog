import { listProfiles, listCategories, listEntries, countsByCategory, completedCount, completedByCategory, sharedCatalogCount, existingSourceKeys, existingSourceKeysWithIds } from '$lib/server/db/queries';
import { countNotes } from '$lib/server/db/notes';
import { listTags } from '$lib/server/db/tags';
import { SORTS, KEPT_FILTERS } from '$lib/constants';
import { readSettings, updateSettings } from '$lib/server/settings';
import { continueWatchingWithPosters } from '$lib/server/continueWatching';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Status, sort, tags and years stay as you last set them, even after closing the app.
 * Whatever the address says wins (and is remembered); anything it leaves out comes from
 * last time. Clearing one puts it in the address empty ("status="), so it clears for good.
 */
function keptView(url: URL): URLSearchParams {
	const saved = new URLSearchParams(readSettings().libraryView ?? '');
	const view = new URLSearchParams();
	let changed = false;
	for (const key of KEPT_FILTERS) {
		const from = url.searchParams.has(key) ? url.searchParams : saved;
		if (from === url.searchParams) changed = true;
		for (const value of from.getAll(key)) if (value) view.append(key, value);
	}
	if (changed && view.toString() !== saved.toString()) updateSettings({ libraryView: view.toString() });
	return view;
}

export const load: PageServerLoad = async ({ url, request }) => {
	// The TV app opens the TV layout (big rows for the remote) unless it's been switched off.
	// With more than one person set up, it starts at "Who's watching?".
	if (/CatalogTV\//.test(request.headers.get('user-agent') ?? '') && readSettings().tvLayout !== 'full') {
		redirect(303, listProfiles().length > 1 ? '/tv/profiles' : '/tv');
	}
	const view = keptView(url);
	const q = (url.searchParams.get('q') ?? '').trim();
	const cat = url.searchParams.get('cat') ?? '';
	const status = view.get('status') ?? '';
	const sortKey = view.get('sort') ?? 'recent';
	const tagIds = view
		.getAll('tag')
		.map((value) => Number(value))
		.filter((value) => Number.isFinite(value) && value > 0);
	const yearFrom = Number(view.get('yearFrom')) || null;
	const yearTo = Number(view.get('yearTo')) || null;

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
		continueWatching: await continueWatchingWithPosters(),
		friendCount: sharedCatalogCount(),
		ownedKeys: [...existingSourceKeys()],
		ownedMap: existingSourceKeysWithIds()
	};
};
