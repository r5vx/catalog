import { rememberAnime, anilistResting, anilistSaidWait } from './anilistNodes';
import { plainText, fameScore, type SearchResult } from './types';
import { getOrderCache, saveOrderCache } from '../db/queries';

const ENDPOINT = 'https://graphql.anilist.co';

const QUERY = `
query ($search: String, $perPage: Int) {
  Page(perPage: $perPage) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id
      title { romaji english }
      startDate { year month day }
      episodes
      duration
      format
      popularity
      averageScore
      coverImage { large }
      relations { edges { relationType node { id format } } }
      description(asHtml: false)
    }
  }
}`;

export type AniListMedia = {
	id: number;
	title: { romaji: string | null; english: string | null };
	startDate: { year: number | null; month?: number | null; day?: number | null };
	episodes: number | null;
	duration: number | null;
	format: string | null;
	popularity: number | null;
	averageScore: number | null;
	coverImage: { large: string | null };
	description: string | null;
};

/**
 * AniList popularity is how many users have the title on a list. Under a
 * thousand means almost nobody has heard of it — the "Black Widow" anime has
 * about 900, which is why it should never outrank the Marvel film.
 */
const scalePopularity = (members: number) => fameScore(members, 1_000, 400_000);

const FORMAT_LABELS: Record<string, string> = {
	// Short-episode and web-released series are still just series to whoever's watching.
	TV: 'Anime',
	TV_SHORT: 'Anime',
	MOVIE: 'Movie',
	SPECIAL: 'Special',
	OVA: 'OVA',
	ONA: 'Anime',
	MUSIC: 'Music'
};

/**
 * AniList needs no API key and only contains anime, so every hit here is
 * confidently an anime — this is what makes "Darling in the Franxx" land in
 * the right category without you telling it.
 */
/** Recent searches, so typing "jojo", deleting and retyping it doesn't ask again. */
const recentSearches = new Map<string, { results: SearchResult[]; at: number }>();
const SEARCH_MEMORY = 10 * 60 * 1000;

export async function searchAniList(query: string, perPage = 20): Promise<SearchResult[]> {
	const key = `${query.toLowerCase()}|${perPage}`;
	const recent = recentSearches.get(key);
	if (recent && Date.now() - recent.at < SEARCH_MEMORY) return recent.results;
	// Told to slow down: skip it for now. TMDB's results still show.
	if (anilistResting()) return [];

	try {
		const response = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ query: QUERY, variables: { search: query, perPage } }),
			signal: AbortSignal.timeout(8000)
		});

		if (response.status === 429) {
			anilistSaidWait(response);
			return [];
		}
		if (!response.ok) return [];

		const payload = (await response.json()) as {
			data?: { Page?: { media?: AniListMedia[] } };
		};

		const media = payload.data?.Page?.media ?? [];
		rememberAnime(media);

		const results = media.map(toResult);
		recentSearches.set(key, { results, at: Date.now() });
		if (recentSearches.size > 200) recentSearches.delete(recentSearches.keys().next().value!);
		return results;
	} catch {
		// Offline, or AniList is having a moment. Search still works via TMDB.
		return [];
	}
}

/** One AniList record in the shape the rest of the app uses. */
export function toResult(item: AniListMedia): SearchResult {
	const title = item.title.english || item.title.romaji || 'Untitled';
	const alt =
		item.title.english && item.title.romaji !== item.title.english ? item.title.romaji : null;

	return {
		key: `anilist:${item.id}`,
		source: 'anilist',
		sourceId: String(item.id),
		title,
		altTitle: alt,
		year: item.startDate?.year ?? null,
		posterUrl: item.coverImage?.large ?? null,
		overview: plainText(item.description),
		categorySlug: 'anime',
		confident: true,
		kind: FORMAT_LABELS[item.format ?? ''] ?? 'Anime',
		episodesTotal: item.episodes ?? null,
		runtimeMinutes: item.duration ?? null,
		// AniList scores out of 100; everything else here is out of 10.
		externalRating: item.averageScore != null ? item.averageScore / 10 : null,
		externalVotes: item.popularity ?? null,
		popularity: scalePopularity(item.popularity ?? 0)
	};
}

const TRENDING = `
query ($perPage: Int, $page: Int, $sort: [MediaSort], $yearGreater: FuzzyDateInt, $yearLesser: FuzzyDateInt, $genre: String, $statusNot: MediaStatus) {
  Page(perPage: $perPage, page: $page) {
    pageInfo { hasNextPage }
    media(type: ANIME, sort: $sort, isAdult: false, startDate_greater: $yearGreater, startDate_lesser: $yearLesser, genre: $genre, status_not: $statusNot) {
      id
      title { romaji english }
      startDate { year month day }
      episodes
      duration
      format
      popularity
      averageScore
      coverImage { large }
      relations { edges { relationType node { id format } } }
      description(asHtml: false)
    }
  }
}`;

const TMDB_GENRE_TO_ANILIST: Record<number, string> = {
	28: 'Action', 12: 'Adventure', 35: 'Comedy', 18: 'Drama',
	14: 'Fantasy', 27: 'Horror', 9648: 'Mystery', 10749: 'Romance',
	878: 'Sci-Fi', 53: 'Thriller'
};

type BrowseSort = 'vote_count' | 'vote_average' | 'popularity' | 'release_date_desc' | 'release_date_asc';

const SORT_MAP: Record<BrowseSort, string[]> = {
	vote_count: ['POPULARITY_DESC'],
	vote_average: ['SCORE_DESC'],
	popularity: ['POPULARITY_DESC'],
	release_date_desc: ['START_DATE_DESC'],
	release_date_asc: ['START_DATE']
};

/**
 * The anime half of the browse page.
 *
 * `trending` is what's being watched this season; `popular` is how many people
 * have it on a list at all, which is the closest thing AniList has to all-time.
 */
export async function trendingAniList(
	perPage = 24,
	page = 1,
	mode: 'trending' | 'popular' = 'trending',
	filters?: { yearFrom?: number; yearTo?: number; sort?: BrowseSort; genre?: number }
): Promise<SearchResult[]> {
	try {
		const hasSort = filters?.sort && SORT_MAP[filters.sort];
		const sort = hasSort
			? SORT_MAP[filters!.sort!]
			: mode === 'popular' ? ['POPULARITY_DESC'] : ['TRENDING_DESC', 'POPULARITY_DESC'];
		const variables: Record<string, unknown> = { perPage, page, sort };

		if (filters?.yearFrom) variables.yearGreater = filters.yearFrom * 10000;
		if (filters?.yearTo) {
			variables.yearLesser = (filters.yearTo + 1) * 10000;
		} else if (filters?.sort === 'release_date_desc') {
			variables.yearLesser = (new Date().getFullYear() + 1) * 10000;
		}

		const aniGenre = filters?.genre ? TMDB_GENRE_TO_ANILIST[filters.genre] : undefined;
		if (aniGenre) variables.genre = aniGenre;

		if (filters?.sort === 'release_date_desc' || filters?.sort === 'release_date_asc') {
			variables.statusNot = 'NOT_YET_RELEASED';
		}

		if (anilistResting()) return [];
		const response = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ query: TRENDING, variables }),
			signal: AbortSignal.timeout(8000)
		});

		if (response.status === 429) {
			anilistSaidWait(response);
			return [];
		}
		if (!response.ok) return [];

		const payload = (await response.json()) as {
			data?: { Page?: { pageInfo?: { hasNextPage?: boolean }; media?: AniListMedia[] } };
		};

		const isDateSort = filters?.sort === 'release_date_desc' || filters?.sort === 'release_date_asc';
		rememberAnime(payload.data?.Page?.media ?? []);
		const results = (payload.data?.Page?.media ?? [])
			.filter((m) => !isDateSort || m.startDate?.year != null)
			.map(toResult);

		if (results.length === 0 && mode === 'trending' && !hasSort) {
			return trendingAniList(perPage, page, 'popular', filters);
		}

		return results;
	} catch {
		return [];
	}
}

/**
 * AniList's other name for a title: the Japanese one in letters, or the English one.
 * Remembered for a month, and not asked while AniList wants Catalog to slow down (so title
 * pages and search, which need AniList most, aren't turned away because of this).
 */
export async function fetchRomajiTitle(title: string): Promise<string | null> {
	const key = `anilist-romaji|${title.toLowerCase()}`;
	const known = getOrderCache(key);
	if (known && Date.now() - known.at < 30 * 24 * 60 * 60 * 1000) return known.value as string | null;
	if (anilistResting()) return null;
	try {
		const response = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ query: QUERY, variables: { search: title, perPage: 1 } })
		});
		if (response.status === 429) anilistSaidWait(response);
		if (!response.ok) return null;
		const payload = (await response.json()) as {
			data?: { Page?: { media?: AniListMedia[] } };
		};
		const media = payload.data?.Page?.media?.[0];
		let other: string | null = null;
		const romaji = media?.title.romaji;
		const english = media?.title.english;
		if (romaji && romaji.toLowerCase() !== title.toLowerCase()) other = romaji;
		else if (english && english.toLowerCase() !== title.toLowerCase()) other = english;
		saveOrderCache(key, other, Date.now());
		return other;
	} catch {
		return null;
	}
}
