import { searchAll, browseShelves, hasTmdbKey, trendingPeopleTmdb, searchPeopleTmdb, type BrowseMode, type BrowseFilters } from '$lib/server/metadata';
import { existingSourceKeysWithIds, libraryPosters } from '$lib/server/db/queries';
import { searchPeople } from '$lib/server/db/people';
import { parseTitle } from '$lib/parseTitle';
import { watchRegion } from '$lib/server/metadata/providers';
import { addonShelves } from '$lib/server/sources/addons';
import type { PageServerLoad } from './$types';

const CATEGORIES = ['movies', 'tv', 'anime'];

/**
 * At most `ms` for what Browse waits on, then `fallback`: the page loads either way. Several slow
 * answers one after another once kept Browse loading, with every click stuck behind it.
 */
function withinTime<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
	return Promise.race([work, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms).unref?.())]);
}
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
		const [localPeople, tmdbPeople] = q.length >= 2
			? await Promise.all([
				Promise.resolve(searchPeople(q)),
				hasTmdbKey() ? withinTime(searchPeopleTmdb(q, 30), 10_000, []) : Promise.resolve([])
			])
			: [[], []];
		const seenNames = new Set(localPeople.map((p) => p.name.toLowerCase()));
		const people = [
			...localPeople.map((p) => ({
				key: `lib:${p.id}`,
				href: `/person/${p.id}`,
				name: p.name,
				photo: p.photo,
				subtitle: `${p.count} ${p.count === 1 ? 'title' : 'titles'} in library${p.sample ? ` · ${p.sample}` : ''}`,
				inLibrary: true
			})),
			...tmdbPeople
				.filter((p) => !seenNames.has(p.name.toLowerCase()))
				.map((p) => ({
					key: p.sourceId,
					href: `/person/${p.sourceId}?name=${encodeURIComponent(p.name)}${p.photo ? `&photo=${encodeURIComponent(p.photo)}` : ''}`,
					name: p.name,
					photo: p.photo,
					subtitle: [p.department, p.knownFor].filter(Boolean).join(' · '),
					inLibrary: false
				}))
		];
		const trending = !q && hasTmdbKey() ? await withinTime(trendingPeopleTmdb(), 15_000, []) : [];
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

	const found = q ? await withinTime(searchAll(title, { year, limit: 60, fuzzy: true }), 15_000, []) : [];

	const results = category ? found.filter((one) => one.categorySlug === category) : found;

	// Rows from Stremio addons' lists come after TMDB's (sources/addons.ts), when nothing narrows
	// the page (their lists can't be filtered by year or genre) and the tab is one they have.
	const addonRows = !q && !filters && category !== 'anime' ? addonShelves(category as '' | 'movies' | 'tv') : Promise.resolve([]);
	const [tmdbShelves, fromAddons] = await Promise.all([
		q ? [] : withinTime(browseShelves(category || undefined, mode, region, filters), 15_000, []),
		withinTime(addonRows, 15_000, [])
	]);
	const shelves = [...tmdbShelves, ...fromAddons];

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
