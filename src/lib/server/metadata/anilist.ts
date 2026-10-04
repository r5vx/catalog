import { plainText, fameScore, type SearchResult } from './types';

const ENDPOINT = 'https://graphql.anilist.co';

const QUERY = `
query ($search: String, $perPage: Int) {
  Page(perPage: $perPage) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id
      title { romaji english }
      startDate { year }
      episodes
      duration
      format
      popularity
      averageScore
      coverImage { large }
      description(asHtml: false)
    }
  }
}`;

type AniListMedia = {
	id: number;
	title: { romaji: string | null; english: string | null };
	startDate: { year: number | null };
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
	TV: 'Anime',
	TV_SHORT: 'TV Short',
	MOVIE: 'Movie',
	SPECIAL: 'Special',
	OVA: 'OVA',
	ONA: 'ONA',
	MUSIC: 'Music'
};

/**
 * AniList needs no API key and only contains anime, so every hit here is
 * confidently an anime — this is what makes "Darling in the Franxx" land in
 * the right category without you telling it.
 */
export async function searchAniList(query: string, perPage = 20): Promise<SearchResult[]> {
	try {
		let response = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ query: QUERY, variables: { search: query, perPage } })
		});

		// AniList caps requests per minute. On a big import we'd rather wait a
		// moment and get the match than silently drop the title.
		if (response.status === 429) {
			const wait = Number(response.headers.get('Retry-After') ?? '2');
			await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 10) * 1000));

			response = await fetch(ENDPOINT, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify({ query: QUERY, variables: { search: query, perPage } })
			});
		}

		if (!response.ok) return [];

		const payload = (await response.json()) as {
			data?: { Page?: { media?: AniListMedia[] } };
		};

		const media = payload.data?.Page?.media ?? [];

		return media.map(toResult);
	} catch {
		// Offline, or AniList is having a moment. Search still works via TMDB.
		return [];
	}
}

/** One AniList record in the shape the rest of the app uses. */
function toResult(item: AniListMedia): SearchResult {
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
      startDate { year }
      episodes
      duration
      format
      popularity
      averageScore
      coverImage { large }
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

		let response = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ query: TRENDING, variables })
		});

		if (response.status === 429) {
			const wait = Number(response.headers.get('Retry-After') ?? '2');
			await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 10) * 1000));
			response = await fetch(ENDPOINT, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify({ query: TRENDING, variables })
			});
		}

		if (!response.ok) return [];

		const payload = (await response.json()) as {
			data?: { Page?: { pageInfo?: { hasNextPage?: boolean }; media?: AniListMedia[] } };
		};

		const isDateSort = filters?.sort === 'release_date_desc' || filters?.sort === 'release_date_asc';
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

export async function fetchRomajiTitle(title: string): Promise<string | null> {
	try {
		const response = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ query: QUERY, variables: { search: title, perPage: 1 } })
		});
		if (!response.ok) return null;
		const payload = (await response.json()) as {
			data?: { Page?: { media?: AniListMedia[] } };
		};
		const media = payload.data?.Page?.media?.[0];
		if (!media) return null;
		const romaji = media.title.romaji;
		if (romaji && romaji.toLowerCase() !== title.toLowerCase()) return romaji;
		const english = media.title.english;
		if (english && english.toLowerCase() !== title.toLowerCase()) return english;
		return null;
	} catch {
		return null;
	}
}
