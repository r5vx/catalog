import { listCategories } from '$lib/server/db/queries';
import { dbPath, dataDir } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({
	// The export picker offers the same categories the library has.
	categories: listCategories(),
	dbPath,
	dataDir
});
