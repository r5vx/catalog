import { allTitleKeys } from '$lib/server/db/people';
import { existingSourceKeys } from '$lib/server/db/queries';
import type { PageServerLoad } from './$types';

/**
 * Someone else's library, opened from a file they sent you.
 *
 * The file is never uploaded — the page reads it in the browser. All the
 * server contributes is a list of what *you* have, so the page can mark the
 * overlap, show what they've seen that you haven't, and show what you've both
 * seen.
 */
export const load: PageServerLoad = async () => ({
	yours: [...allTitleKeys()],
	// Matching on the database's own id is exact, where matching on the title
	// is a guess. Newer share files carry ids; older ones fall back to names.
	yourKeys: [...existingSourceKeys()]
});
