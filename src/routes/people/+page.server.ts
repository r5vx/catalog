import { searchPeople } from '$lib/server/db/people';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	return { q, people: q.length >= 2 ? searchPeople(q) : [] };
};
