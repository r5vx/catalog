import { searchPeople } from '$lib/server/db/people';
import { trendingPeopleTmdb, hasTmdbKey } from '$lib/server/metadata';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	const people = q.length >= 2 ? searchPeople(q) : [];
	const trending = !q && hasTmdbKey() ? await trendingPeopleTmdb() : [];
	return { q, people, trending };
};
