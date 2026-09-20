import { json } from '@sveltejs/kit';
import { browsePage, BROWSE_CATEGORIES, type BrowseMode } from '$lib/server/metadata';
import { existingSourceKeys } from '$lib/server/db/queries';
import { watchRegion } from '$lib/server/metadata/providers';
import type { RequestHandler } from './$types';

/**
 * One more page of a browse shelf.
 *
 * Paged rather than loaded in bulk: "show me more" is a question you ask when
 * nothing on screen appealed, and there's no telling how many times you'll
 * ask. The page appends what comes back instead of reloading.
 */
export const GET: RequestHandler = async ({ url }) => {
	const category = url.searchParams.get('cat') ?? '';
	const mode: BrowseMode = url.searchParams.get('mode') === 'popular' ? 'popular' : 'trending';
	const page = Math.min(Math.max(Number(url.searchParams.get('page')) || 1, 1), 500);

	if (!BROWSE_CATEGORIES.includes(category as (typeof BROWSE_CATEGORIES)[number])) {
		return json({ results: [], page, owned: [] });
	}

	return json({
		results: await browsePage(category, mode, page, watchRegion()),
		page,
		// Sent with each page so newly loaded cards know what's already yours.
		owned: [...existingSourceKeys()]
	});
};
