import { searchAniList } from './anilist';
import { searchTmdb, hasTmdbKey } from './tmdb';
import { normalizeTitle, type SearchResult } from './types';

export { hasTmdbKey };
export type { SearchResult };

/** 3 = exact title, 2 = starts with, 1 = contains, 0 = neither. */
function matchScore(result: SearchResult, query: string): number {
	const q = normalizeTitle(query);
	if (!q) return 0;

	const candidates = [result.title, result.altTitle].filter(Boolean).map((t) => normalizeTitle(t!));

	let best = 0;
	for (const candidate of candidates) {
		if (candidate === q) best = Math.max(best, 3);
		// "Marvel's Daredevil" ends with "daredevil" — a studio prefix shouldn't
		// push the series far below the film of the same name.
		else if (candidate.startsWith(q) || candidate.endsWith(q)) best = Math.max(best, 2);
		else if (candidate.includes(q)) best = Math.max(best, 1);
	}
	return best;
}

/**
 * How results get ordered.
 *
 * How well the title matches comes first and can't be outweighed — searching
 * "Fantastic Four" should never hand you Avengers just because it's bigger.
 * Within titles that match equally well, the better known one wins, which is
 * why "Iron Man" gives you the film rather than the obscure anime of the same
 * name. A year you supplied breaks the remaining ties.
 */
function scoreOf(result: SearchResult, query: string, year: number | null): number {
	const yearMatches = year !== null && result.year === year;

	return (
		matchScore(result, query) * 10 + // 0, 10, 20 or 30 — the dominant term
		(yearMatches ? 4 : 0) + //           a nudge, never enough to jump a tier
		result.popularity * 5 //             0 to 5, orders everything within a tier
	);
}

type Scored = { result: SearchResult; score: number };

/**
 * Anime shows exist in both providers. When AniList and TMDB return what is
 * clearly the same thing, keep AniList — it knows episode counts and seasons.
 * For anything else, the better score wins.
 */
function dedupe(scored: Scored[]): Scored[] {
	const seen = new Map<string, Scored>();

	for (const item of scored) {
		// The category has to be part of this. "Star Wars: The Clone Wars" is both
		// a 2008 series AND a 2008 film — same title, same year, different things.
		// Without the category they collapsed into one and the film vanished.
		const fingerprint = [
			normalizeTitle(item.result.title),
			item.result.year ?? '?',
			item.result.categorySlug
		].join('|');

		const existing = seen.get(fingerprint);

		if (!existing) {
			seen.set(fingerprint, item);
			continue;
		}

		const bothAnime =
			item.result.categorySlug === 'anime' && existing.result.categorySlug === 'anime';

		const preferNew = bothAnime
			? item.result.source === 'anilist' && existing.result.source !== 'anilist'
			: item.score > existing.score;

		if (preferNew) seen.set(fingerprint, item);
	}

	return [...seen.values()];
}

type SearchOptions = { year?: number | null; limit?: number };

/** Search both providers at once and return one merged, ranked list. */
export async function searchAll(
	query: string,
	{ year = null, limit = 12 }: SearchOptions = {}
): Promise<SearchResult[]> {
	const trimmed = query.trim();
	if (trimmed.length < 2) return [];

	const [anime, other] = await Promise.all([searchAniList(trimmed), searchTmdb(trimmed)]);

	const scored = [...anime, ...other].map((result) => ({
		result,
		score: scoreOf(result, trimmed, year)
	}));

	return dedupe(scored)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((item) => item.result);
}

/** The handful of best guesses for a title, used by the bulk importer. */
export async function bestMatch(title: string, year: number | null = null) {
	return searchAll(title, { year, limit: 5 });
}
