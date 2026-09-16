import { allTitleKeys } from '$lib/server/db/people';
import type { PageServerLoad } from './$types';

/**
 * Someone else's library, opened from a file they sent you.
 *
 * The file is never uploaded — the page reads it in the browser. All the
 * server contributes is a list of what *you* have, so the page can mark the
 * overlap and, more usefully, show what they've seen that you haven't.
 */
export const load: PageServerLoad = async () => ({
	yours: [...allTitleKeys()]
});
