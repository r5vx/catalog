import { listCategories, listEntries, countsByCategory, completedCount, completedByCategory, continueWatchingList, sharedCatalogCount, existingSourceKeys, existingSourceKeysWithIds } from '$lib/server/db/queries';
import { countNotes } from '$lib/server/db/notes';
import { listTags } from '$lib/server/db/tags';
import { SORTS, KEPT_FILTERS } from '$lib/constants';
import { readSettings, updateSettings } from '$lib/server/settings';
import { tmdbShow } from '$lib/server/combinedEpisodes';
import type { PageServerLoad } from './$types';

/**
 * Continue Watching, with TMDB's poster for shows that have none (one only another source has,
 * or one Showbox's poster didn't come through for). Saved TMDB answers make this instant after
 * the first time; it never holds the page up more than a second and a half.
 */
async function continueWatchingWithPosters() {
	const list = continueWatchingList();
	const missing = list.filter((item) => !item.posterUrl && item.type === 'tv');
	if (!missing.length) return list;
	await Promise.race([
		Promise.all(
			missing.map(async (item) => {
				item.posterUrl = (await tmdbShow(item.title, '').catch(() => null))?.poster ?? null;
			})
		),
		new Promise((resolve) => setTimeout(resolve, 1500))
	]);
	return list;
}

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

export const load: PageServerLoad = async ({ url }) => {
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
