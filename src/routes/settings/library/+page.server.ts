import { listCategories } from '$lib/server/db/queries';
import { missingCount } from '$lib/server/backfill';
import { desktopAvailable } from '$lib/server/pdf';
import { dbPath, dataDir } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({
	// The export picker offers the same categories the library has.
	categories: listCategories(),
	// Only the desktop app can render a PDF; a browser gets the print page.
	canMakePdf: desktopAvailable(),
	// How many titles are still missing a runtime, synopsis or scores.
	missing: missingCount(),
	dbPath,
	dataDir
});
