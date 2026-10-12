/**
 * Anime in the library that came from AniList, moved over to TMDB's copy of the same show or
 * film, so Catalog no longer asks AniList about it (AniList turns Catalog away after thirty
 * questions a minute, and it held up everything else).
 *
 * What's yours stays: the name it's listed under (watch progress goes by it), rating, status,
 * notes, dates, rewatches. What came from AniList is replaced from TMDB: synopsis, tags, cast,
 * episode count, and the poster if it was AniList's.
 *
 * Only a sure match is moved: the same name (TMDB's or its original Japanese one), the same
 * year give or take one, and the right kind (a film for a one-episode title, a series
 * otherwise). Anything else stays as it is, and can be pointed at TMDB by hand with "Wrong
 * match?" on its page. Run once, a minute after Catalog opens (hooks.server.ts).
 */
import { db } from './db';
import { updateEntrySource, saveOverview, saveFacts, clearScoreStamp } from './db/queries';
import { setTags } from './db/tags';
import { setCast } from './db/people';
import { searchTmdb } from './metadata/tmdb';
import { fetchDetails } from './metadata/details';
import { normalizeTitle, withoutQualifier, type SearchResult } from './metadata/types';

type Row = { id: number; title: string; year: number | null; episodes: number | null; poster: string | null; sourceId: string };

/** "(TV)", "Season 2", punctuation: none of it decides whether two names are the same show. */
const same = (a: string, b: string) => normalizeTitle(withoutQualifier(a)) === normalizeTitle(withoutQualifier(b));

export async function tmdbMatchFor(row: Pick<Row, 'title' | 'year' | 'episodes'>): Promise<SearchResult | null> {
	const found = await searchTmdb(withoutQualifier(row.title));
	const film = row.episodes === 1;
	const candidates = found.filter(
		(r) =>
			r.source === 'tmdb' &&
			r.categorySlug === 'anime' &&
			r.sourceId.startsWith(film ? 'movie:' : 'tv:') &&
			(same(r.title, row.title) || (r.altTitle !== null && same(r.altTitle, row.title))) &&
			(!row.year || !r.year || Math.abs(r.year - row.year) <= 1)
	);
	if (candidates.length === 1) return candidates[0];
	// Two equally good answers is a guess, unless only one is from the very same year.
	if (candidates.length > 1) {
		const exactYear = candidates.filter((r) => r.year === row.year);
		return exactYear.length === 1 ? exactYear[0] : null;
	}
	// No name matches: TMDB lists some under another name, found by the one it was searched
	// for (Bakemonogatari is its "Monogatari", 化物語). Taken only when it's the one anime of
	// the right kind from that very year among what TMDB found.
	const sameYear = found.filter(
		(r) => r.source === 'tmdb' && r.categorySlug === 'anime' && r.sourceId.startsWith(film ? 'movie:' : 'tv:') && r.year === row.year
	);
	return row.year && sameYear.length === 1 ? sameYear[0] : null;
}

export type MoveReport = { moved: { id: number; title: string; to: string }[]; left: { id: number; title: string; why: string }[] };

export async function moveOffAniList(dryRun = false): Promise<MoveReport> {
	const report: MoveReport = { moved: [], left: [] };
	const rows = db
		.prepare(
			`SELECT id, title, year, episodes_total AS episodes, poster_url AS poster, source_id AS sourceId
			 FROM entries WHERE source = 'anilist' ORDER BY id`
		)
		.all() as Row[];
	const taken = new Set(
		(db.prepare("SELECT source_id AS s FROM entries WHERE source = 'tmdb'").all() as { s: string }[]).map((r) => r.s)
	);

	for (const row of rows) {
		const match = await tmdbMatchFor(row).catch(() => null);
		if (!match) {
			report.left.push({ id: row.id, title: row.title, why: 'no sure match on TMDB' });
			continue;
		}
		if (taken.has(match.sourceId)) {
			report.left.push({ id: row.id, title: row.title, why: `TMDB's ${match.title} is already in the library` });
			continue;
		}
		taken.add(match.sourceId);
		report.moved.push({ id: row.id, title: row.title, to: `${match.title} (${match.year ?? '?'}) ${match.sourceId}` });
		if (dryRun) continue;

		const details = await fetchDetails('tmdb', match.sourceId);
		if (!details.title) {
			report.moved.pop();
			report.left.push({ id: row.id, title: row.title, why: 'TMDB did not answer' });
			continue;
		}
		updateEntrySource(row.id, 'tmdb', match.sourceId);
		if (details.overview) saveOverview(row.id, details.overview);
		if (details.tags.length) setTags(row.id, details.tags);
		if (details.cast.length) setCast(row.id, details.cast);
		saveFacts(row.id, { runtimeMinutes: details.runtimeMinutes, episodesTotal: details.episodesTotal, checked: true });
		db.prepare('UPDATE entries SET external_rating = ?, external_votes = ? WHERE id = ?').run(
			details.externalRating ?? null,
			details.externalVotes ?? null,
			row.id
		);
		if (details.posterUrl && (!row.poster || row.poster.includes('anilist.co'))) {
			db.prepare('UPDATE entries SET poster_url = ? WHERE id = ?').run(details.posterUrl, row.id);
		}
		// AniList's "(TV)" on the end of the name goes, unless something's been watched under it
		// (watch progress goes by the name).
		const tidy = withoutQualifier(row.title);
		if (tidy !== row.title && !db.prepare('SELECT 1 FROM watch_progress WHERE lower(title) = lower(?)').get(row.title)) {
			db.prepare('UPDATE entries SET title = ? WHERE id = ?').run(tidy, row.id);
		}
		// IMDb and Rotten Tomatoes scores, looked up again by the backfill now there's an IMDb id.
		clearScoreStamp(row.id);
		// Gentle on TMDB.
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return report;
}
