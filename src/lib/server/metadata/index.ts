import { searchAniList, trendingAniList } from './anilist';
import { searchTmdb, trendingTmdb, trendingPeopleTmdb, hasTmdbKey } from './tmdb';
export { trendingPeopleTmdb };
import { normalizeTitle, type SearchResult } from './types';

export { hasTmdbKey };
export type { SearchResult };

const ARTICLES = /^(the|a|an)\s+/;

function stripArticle(s: string): string {
	return s.replace(ARTICLES, '');
}

/** 3 = exact title, 2 = starts with, 1 = contains, 0 = neither. */
function matchScore(result: SearchResult, query: string): number {
	const q = normalizeTitle(query);
	if (!q) return 0;
	const qNoArticle = stripArticle(q);

	const candidates = [result.title, result.altTitle].filter(Boolean).map((t) => normalizeTitle(t!));

	let best = 0;
	for (const candidate of candidates) {
		const cNoArticle = stripArticle(candidate);
		if (candidate === q || cNoArticle === qNoArticle) best = Math.max(best, 3);
		else if (candidate.startsWith(q) || candidate.endsWith(q)
			|| cNoArticle.startsWith(qNoArticle) || cNoArticle.endsWith(qNoArticle))
			best = Math.max(best, 2);
		else if (candidate.includes(q) || cNoArticle.includes(qNoArticle)) best = Math.max(best, 1);
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


/* ---------------------------------------------------------------- browsing */

export type BrowseMode = 'trending' | 'popular';

export type Shelf = {
	key: string;
	label: string;
	results: SearchResult[];
	/** Which page these came from, so "show more" knows what to ask for next. */
	page: number;
};

export const BROWSE_CATEGORIES = ['movies', 'tv', 'anime'] as const;

const LABELS: Record<string, Record<BrowseMode, string>> = {
	movies: { trending: 'Films people are watching', popular: 'The biggest films of all time' },
	tv: { trending: 'Series people are watching', popular: 'The biggest series of all time' },
	anime: { trending: 'Anime people are watching', popular: 'The biggest anime of all time' }
};

/** One category, one page of it. Everything else here is built on this. */
export async function browsePage(
	category: string,
	mode: BrowseMode,
	page: number,
	region?: string
): Promise<SearchResult[]> {
	if (category === 'anime') return trendingAniList(24, page, mode);
	if (category === 'movies') return trendingTmdb('movie', page, mode, region);
	if (category === 'tv') return trendingTmdb('tv', page, mode, region);
	return [];
}

/**
 * What to show someone who hasn't typed anything yet.
 *
 * Search only helps when you already know the name of the thing you want.
 * Browsing is for the other half of the problem — finding something you've
 * never heard of — so the page opens on whole shelves of it, and each one
 * keeps going for as long as you keep asking.
 */
export async function browseShelves(only?: string, mode: BrowseMode = 'trending', region?: string): Promise<Shelf[]> {
	const wanted = only
		? BROWSE_CATEGORIES.filter((one) => one === only)
		: [...BROWSE_CATEGORIES];

	const filled = await Promise.all(
		wanted.map(async (key) => ({
			key,
			label: LABELS[key][mode],
			results: await browsePage(key, mode, 1, region),
			page: 1
		}))
	);

	return filled.filter((shelf) => shelf.results.length > 0);
}
