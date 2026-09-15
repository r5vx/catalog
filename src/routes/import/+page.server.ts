import { listCategories } from '$lib/server/db/queries';
import { hasTmdbKey } from '$lib/server/metadata';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({
	categories: listCategories(),
	tmdbEnabled: hasTmdbKey()
});
