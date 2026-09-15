import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { categoryIdForSlug, getEntry } from '$lib/server/db/queries';
import type { SearchResult } from '$lib/server/metadata';
import type { RequestHandler } from './$types';

/**
 * Point an existing entry at a different title.
 *
 * Only the facts that came from the database are replaced - poster, year,
 * episode count, category. Everything that is yours (rating, status, notes,
 * rewatches, the dates you watched it) is left exactly as it was, because the
 * whole point is that you already recorded those and should not lose them just
 * to correct which version it is.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { id?: number; result?: SearchResult };

	if (!body.id || !body.result?.title) error(400, 'Need an entry and a replacement.');
	if (!getEntry(body.id)) error(404, 'That entry no longer exists.');

	const categoryId = categoryIdForSlug(body.result.categorySlug);

	db.prepare(
		`UPDATE entries SET
			title = ?, year = ?, poster_url = ?, overview = ?,
			source = ?, source_id = ?, episodes_total = ?, runtime_minutes = ?,
			external_rating = ?, external_votes = ?, category_id = ?, updated_at = ?
		WHERE id = ?`
	).run(
		body.result.title,
		body.result.year,
		body.result.posterUrl,
		body.result.overview,
		body.result.source,
		body.result.sourceId,
		body.result.episodesTotal,
		body.result.runtimeMinutes,
		body.result.externalRating ?? null,
		body.result.externalVotes ?? null,
		categoryId,
		new Date().toISOString(),
		body.id
	);

	return json({ ok: true });
};
