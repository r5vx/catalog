import { json } from '@sveltejs/kit';
import { existingSourceKeys } from '$lib/server/db/queries';
import { createFromResult } from '$lib/server/entries';
import type { SearchResult } from '$lib/server/metadata';
import type { RequestHandler } from './$types';

type Incoming = {
	result: SearchResult;
	categoryId?: number | null;
	lastSeason?: number | null;
	lastEpisode?: number | null;
	/** From another site's list (src/routes/import/list): how it stood there, and your score out of 10. */
	status?: string;
	rating?: number | null;
};

const STATUSES = ['watching', 'completed', 'paused', 'dropped', 'planned', 'rewatching'];

/**
 * Bulk import from a pasted list. Finished dates are deliberately left empty
 * here - these are things you watched at some point in the past, and guessing a
 * date would be worse than leaving it blank.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { items } = (await request.json()) as { items: Incoming[] };

	// Anything already in the library is skipped, so re-running an import does
	// not create duplicates.
	const existing = existingSourceKeys();

	let imported = 0;
	let skipped = 0;

	for (const item of items ?? []) {
		if (!item?.result?.title) continue;

		const fingerprint = `${item.result.source}:${item.result.sourceId}`;
		if (existing.has(fingerprint)) {
			skipped++;
			continue;
		}

		createFromResult(item.result, {
			categoryId: item.categoryId,
			markWatchedToday: false,
			lastSeason: item.lastSeason ?? null,
			lastEpisode: item.lastEpisode ?? null,
			status: item.status && STATUSES.includes(item.status) ? item.status : undefined,
			rating: typeof item.rating === 'number' && item.rating > 0 && item.rating <= 10 ? Math.round(item.rating * 2) / 2 : null
		});

		existing.add(fingerprint);
		imported++;
	}

	return json({ imported, skipped });
};
