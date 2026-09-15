import { readSettings, pinIsSet } from '$lib/server/settings';
import { omdbConfigured } from '$lib/server/metadata/omdb';
import { countsByCategory } from '$lib/server/db/queries';
import { countNotes } from '$lib/server/db/notes';
import { dbPath } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/** A one-glance summary, so the index isn't just a menu on a wide screen. */
export const load: PageServerLoad = async () => ({
	tmdbKeySaved: Boolean(readSettings().tmdbApiKey),
	extraScores: omdbConfigured(),
	pinSet: pinIsSet(),
	entries: Object.values(countsByCategory()).reduce((sum, n) => sum + n, 0),
	notes: countNotes(),
	dbPath
});
