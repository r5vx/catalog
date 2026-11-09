import { tvLibrary, listCategories, listEntries, countsByCategory, completedCount, completedByCategory, sharedCatalogCount, existingSourceKeys, existingSourceKeysWithIds } from '$lib/server/db/queries';
import { countNotes } from '$lib/server/db/notes';
import { withNextAir } from '$lib/server/nextAirs';
import { listTags } from '$lib/server/db/tags';
import { SORTS, KEPT_FILTERS } from '$lib/constants';
import { readSettings } from '$lib/server/settings';
import { continueWatchingWithPosters } from '$lib/server/continueWatching';
import { redirect } from '@sveltejs/kit';
import { currentProfile, MAIN_PROFILE } from '$lib/server/profile';
import { isWatched } from '$lib/constants';
import type { EntryCard } from '$lib/server/db/types';
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

	// On a phone, someone other than the library's owner: their own list, as the TV shows them.
	if (currentProfile() !== MAIN_PROFILE) {
		return { ...ownList({ q, category: activeCategory, status }, categories), filters: { q, cat, status, sort: sort.value, tags: [] as number[], yearFrom: null, yearTo: null }, rememberView: null, continueWatching: await continueWatchingWithPosters(), friendCount: 0, ownedKeys: [] as string[], ownedMap: {} as ReturnType<typeof existingSourceKeysWithIds> };
	}

	// Caught-up shows carry their next episode's air date (their card's countdown).
	const entries = withNextAir(listEntries({
		search: q,
		categoryId: activeCategory?.id ?? null,
		status,
		tagIds,
		yearFrom,
		yearTo,
		sortColumn: sort.column,
		sortDir: sort.dir
	}));

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
		ownedMap: existingSourceKeysWithIds(),
		ownList: false
	};
};

/**
 * A profile's own list (profile_titles) as the library grid shows it, for a phone where someone
 * other than the library's owner was picked. The grid used to stay the owner's on phones: the
 * owner's library showed under every profile (2026-11-08). Cards open the
 * title's page; the owner-only parts (editing, tags, notes, shared catalogs) aren't offered.
 */
function ownList(filter: { q: string; category: { id: number; slug: string } | undefined; status: string }, categories: ReturnType<typeof listCategories>) {
	const bySlug = new Map(categories.map((c) => [c.slug, c]));
	const all = withNextAir(tvLibrary()).map((item) => {
		const category = bySlug.get(item.category ?? '');
		return {
			...item,
			categoryId: category?.id ?? 0,
			categoryName: item.categoryName ?? category?.name ?? '',
			categoryEmoji: category?.emoji ?? '',
			favorite: false,
			link: item.source && item.sourceId ? `/title/${item.source}/${encodeURIComponent(item.sourceId)}` : `/watch?title=${encodeURIComponent(item.title)}`
		} as unknown as EntryCard & { link: string };
	});
	const words = filter.q.toLowerCase();
	const entries = all.filter(
		(e) =>
			(!words || e.title.toLowerCase().includes(words)) &&
			(!filter.category || e.categoryId === filter.category.id) &&
			(!filter.status || (filter.status === 'completed' ? isWatched(e.status) : e.status === filter.status))
	);
	const count = (list: typeof all) => list.reduce<Record<number, number>>((n, e) => ((n[e.categoryId] = (n[e.categoryId] ?? 0) + 1), n), {});
	const watched = all.filter((e) => isWatched(e.status));
	return {
		entries,
		categories,
		countByCategory: count(all),
		total: all.length,
		completed: watched.length,
		completedByCategory: count(watched),
		noteCount: 0,
		tags: [] as ReturnType<typeof listTags>,
		/** This profile's own list: no editing, tags or notes here. */
		ownList: true
	};
}
