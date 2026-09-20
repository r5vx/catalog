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
	TV: 'TV',
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
query ($perPage: Int, $page: Int, $sort: [MediaSort]) {
  Page(perPage: $perPage, page: $page) {
    media(type: ANIME, sort: $sort, isAdult: false) {
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

/**
 * The anime half of the browse page.
 *
 * `trending` is what's being watched this season; `popular` is how many people
 * have it on a list at all, which is the closest thing AniList has to all-time.
 */
export async function trendingAniList(
	perPage = 24,
	page = 1,
	mode: 'trending' | 'popular' = 'trending'
): Promise<SearchResult[]> {
	try {
		const sort = mode === 'popular' ? ['POPULARITY_DESC'] : ['TRENDING_DESC'];

		const response = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ query: TRENDING, variables: { perPage, page, sort } })
		});

		if (!response.ok) return [];

		const payload = (await response.json()) as {
			data?: { Page?: { media?: AniListMedia[] } };
		};

		return (payload.data?.Page?.media ?? []).map(toResult);
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
