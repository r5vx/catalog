import { listCategories, listEntries, countsByCategory, completedCount, completedByCategory, sharedCatalogCount, existingSourceKeys, existingSourceKeysWithIds } from '$lib/server/db/queries';
import { countNotes } from '$lib/server/db/notes';
import { listTags } from '$lib/server/db/tags';
import { SORTS, KEPT_FILTERS } from '$lib/constants';
import { readSettings } from '$lib/server/settings';
import { continueWatchingWithPosters } from '$lib/server/continueWatching';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Status, sort, tags and years stay as you last set them, even after closing the app.
 * Whatever the address says wins; anything it leaves out comes from last time. Clearing one
 * puts it in the address empty ("status="), so it clears for good.
 *
 * Remembered by the page once it's really been opened (`remember`), not here: this also runs
 * when a link to the library is only pointed at (the app loads a page ahead on hover), and
 * pointing at a studio's chip on Dungeon Meshi's page filtered the library by "Ultra Super
 * Pictures" (2026-10-23).
 */
function keptView(url: URL): { view: URLSearchParams; remember: string | null } {
	const saved = new URLSearchParams(readSettings().libraryView ?? '');
	const view = new URLSearchParams();
	let changed = false;
	for (const key of KEPT_FILTERS) {
		const from = url.searchParams.has(key) ? url.searchParams : saved;
		if (from === url.searchParams) changed = true;
		for (const value of from.getAll(key)) if (value) view.append(key, value);
	}
	return { view, remember: changed && view.toString() !== saved.toString() ? view.toString() : null };
}

export const load: PageServerLoad = async ({ url, request }) => {
	// The TV app opens the TV layout (big rows for the remote) unless it's been switched off.
	// It starts at "Who's watching?", every time the TV app opens (like Netflix).
	if (/CatalogTV\//.test(request.headers.get('user-agent') ?? '') && readSettings().tvLayout !== 'full') {
		redirect(303, '/tv/profiles');
	}
	const { view, remember } = keptView(url);
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
		/** The view to remember for next time, once this page is shown (null: nothing new). */
		rememberView: remember,
		continueWatching: await continueWatchingWithPosters(),
		friendCount: sharedCatalogCount(),
		ownedKeys: [...existingSourceKeys()],
		ownedMap: existingSourceKeysWithIds()
	};
};
