import { db } from './db';
import { categoryIdForSlug, getEntry } from './db/queries';
import { searchAll, type SearchResult } from './metadata';
import { normalizeTitle } from './metadata/types';

/**
 * Titles added with only a name (Continue Watching's "Mark as completed" for something not in the
 * library: the player only knows the name and Showbox's poster) had no TMDB number, so nothing else
 * could ever be looked up for them: no synopsis, cast, IMDb, Rotten Tomatoes or Metacritic
 * (Thunderbolts*, 2026-11-04). Here they're found on TMDB by name.
 *
 * Only a sure match is taken: the same name (or its other name), the right kind (film or show), and
 * the same year when the year is known. Otherwise nothing changes and "Wrong match?" on the title's
 * page is there to pick it by hand.
 */
export async function findOnTmdb(title: string, categorySlug: string | null, year: number | null): Promise<SearchResult | null> {
	const wanted = normalizeTitle(title);
	if (!wanted) return null;
	const results = await searchAll(title, { year, limit: 8 }).catch(() => [] as SearchResult[]);
	const kinds = categorySlug === 'movies' ? ['movies'] : categorySlug ? ['tv', 'anime'] : null;
	const same = results.filter(
		(r) =>
			r.sourceId &&
			(normalizeTitle(r.title) === wanted || (r.altTitle && normalizeTitle(r.altTitle) === wanted)) &&
			(!kinds || kinds.includes(r.categorySlug)) &&
			(!year || !r.year || r.year === year)
	);
	// Two of the same name and kind (a remake) with no year to tell them apart: not sure.
	if (same.length > 1 && !year && same[0].year !== same[1].year) {
		// TMDB's own order puts the better-known one first; take it only when it's far ahead.
		if ((same[0].popularity ?? 0) < 5 * (same[1].popularity ?? 0)) return null;
	}
	return same[0] ?? null;
}

/**
 * Points an entry at a title found on TMDB: only the facts that came from the database (name,
 * year, poster, synopsis, kind); everything that's yours (status, rating, notes, dates, rewatches)
 * stays. Shared with "Wrong match?".
 */
export function pointEntryAt(id: number, result: SearchResult): void {
	db.prepare(
		`UPDATE entries SET
			title = ?, year = ?, poster_url = ?, overview = ?,
			source = ?, source_id = ?, episodes_total = ?, runtime_minutes = ?,
			external_rating = ?, external_votes = ?, category_id = ?, updated_at = ?
		WHERE id = ?`
	).run(
		result.title,
		result.year,
		result.posterUrl,
		result.overview,
		result.source,
		result.sourceId,
		result.episodesTotal,
		result.runtimeMinutes,
		result.externalRating ?? null,
		result.externalVotes ?? null,
		categoryIdForSlug(result.categorySlug),
		new Date().toISOString(),
		id
	);
}

/** An entry with no TMDB (or AniList) number: found by name and linked. True when it was. */
export async function linkIfUnmatched(id: number): Promise<boolean> {
	const entry = getEntry(id);
	if (!entry || entry.sourceId) return false;
	const slug = (db.prepare('SELECT slug FROM categories WHERE id = ?').get(entry.categoryId) as { slug: string } | undefined)?.slug ?? null;
	const match = await findOnTmdb(entry.title, slug, entry.year);
	if (!match) return false;
	pointEntryAt(id, match);
	return true;
}

/**
 * Every entry with no TMDB (or AniList) number, linked shortly after Catalog starts, one at a time.
 * Waiting for each title's page to be opened left Thunderbolts* and Venom: The Last Dance without a
 * year in the library for days (2026-11-06). One TMDB search each; an entry with no sure match is
 * left as it is (and asked again next start).
 */
export function linkUnmatchedSoon(): void {
	setTimeout(async () => {
		const ids = (db.prepare("SELECT id FROM entries WHERE source_id IS NULL OR source_id = ''").all() as { id: number }[]).map((r) => r.id);
		let linked = 0;
		for (const id of ids) {
			if (await linkIfUnmatched(id).catch(() => false)) linked += 1;
		}
		if (ids.length) console.log(`[link] ${linked} of ${ids.length} name-only entries matched on TMDB`);
	}, 20_000).unref?.();
}
