import { env } from '$env/dynamic/private';
import { readSettings } from '../settings';
import { plainText, fameScore, type SearchResult } from './types';

const BASE = 'https://api.themoviedb.org/3';
const IMAGE = 'https://image.tmdb.org/t/p/w342';

const ANIMATION_GENRE_ID = 16;

/**
 * How well known a TMDB title is.
 *
 * Its `popularity` field is a rolling "trending this week" score, NOT fame —
 * which is how a 1987 TV show came out above the 2012 "21 Jump Street" film.
 * `vote_count` is the honest measure: the film has thousands of ratings, the
 * old show has a handful, and that doesn't change week to week.
 *
 * Popularity still gets a small say, so a film released last week that nobody
 * has rated yet doesn't vanish.
 */
function scaleFame(votes: number, trending: number): number {
	const byVotes = fameScore(votes, 50, 20_000);
	const byTrend = fameScore(trending, 1, 500) * 0.6;

	return Math.max(byVotes, byTrend);
}

/** The Settings page is the normal place for this; the env var is a fallback. */
const tmdbKey = () => (readSettings().tmdbApiKey || env.TMDB_API_KEY || '').trim();

export const hasTmdbKey = () => Boolean(tmdbKey());

/**
 * TMDB hands out two different credentials and doesn't make it obvious which
 * is which. Both work here:
 *
 *   "API Key"                  — 32 hex characters, goes in the query string
 *   "API Read Access Token"    — a long token starting `eyJ`, goes in a header
 *
 * Paste whichever one you have and this figures it out.
 */
function authorize(url: URL, key: string): RequestInit {
	if (key.startsWith('eyJ')) {
		return { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } };
	}

	url.searchParams.set('api_key', key);
	return { headers: { Accept: 'application/json' } };
}

type TmdbItem = {
	id: number;
	media_type: 'movie' | 'tv' | 'person';
	title?: string;
	name?: string;
	original_title?: string;
	original_name?: string;
	release_date?: string;
	first_air_date?: string;
	poster_path?: string | null;
	overview?: string | null;
	popularity?: number;
	vote_count?: number;
	vote_average?: number;
	original_language?: string;
	genre_ids?: number[];
};

const yearOf = (date?: string) => {
	const year = Number((date ?? '').slice(0, 4));
	return Number.isFinite(year) && year > 1800 ? year : null;
};

/**
 * Japanese + animated is our anime test. It catches the big cases correctly and
 * when it's wrong you can change the category on the entry in one click.
 */
function categorize(item: TmdbItem): { slug: 'anime' | 'movies' | 'tv'; confident: boolean } {
	const animated = item.genre_ids?.includes(ANIMATION_GENRE_ID) ?? false;
	const japanese = item.original_language === 'ja';

	if (animated && japanese) return { slug: 'anime', confident: true };

	// Animated but not Japanese, or Japanese but not animated: probably right,
	// but worth a glance.
	const slug = item.media_type === 'movie' ? 'movies' : 'tv';
	return { slug, confident: !(animated || japanese) };
}

/**
 * Ask TMDB whether a key actually works, so a typo gets caught when you paste
 * it rather than silently returning no results forever.
 */
export async function verifyTmdbKey(key: string): Promise<{ ok: boolean; message: string }> {
	try {
		const url = new URL(`${BASE}/configuration`);
		const init = authorize(url, key.trim());

		const response = await fetch(url, init);

		if (response.ok) {
			const kind = key.trim().startsWith('eyJ') ? 'Read Access Token' : 'API key';
			return { ok: true, message: `That ${kind} works. Movie and TV search is on.` };
		}

		if (response.status === 401) {
			return {
				ok: false,
				message:
					'TMDB rejected that. Copy either the "API Key" or the "API Read Access Token" from your TMDB API settings — both work, but check for stray spaces.'
			};
		}

		return { ok: false, message: `TMDB returned ${response.status}.` };
	} catch {
		return { ok: false, message: 'Could not reach TMDB. Check your internet connection.' };
	}
}

/**
 * TMDB's search doesn't normalise punctuation, so "wall-e" finds nothing at all
 * — the real title is "WALL·E", with a middle dot. When a search comes back
 * empty we retry with the obvious punctuation variants before giving up.
 */
/** Punctuation forms to fall back on when a search finds nothing at all. */
function punctuationVariants(query: string): string[] {
	if (!/[\s\-_]/.test(query)) return [];

	return [
		query.replace(/[\s\-_]+/g, '·'), // wall-e -> wall·e
		query.replace(/[\s\-_]+/g, ''), //        wall-e -> walle
		query.replace(/[\s\-_]+/g, ' ') //        wall-e -> wall e
	];
}

/**
 * TMDB treats "and" and "&" as different words: "drake and josh" finds only a
 * spin-off film, "drake & josh" finds the series. Neither form returns nothing,
 * so we can't wait for an empty result — both are always searched and merged.
 */
function conjunctionVariant(query: string): string | null {
	// Word boundaries matter: without them "WandaVision" becomes "W&aVision".
	if (/\band\b/i.test(query)) return query.replace(/\band\b/gi, '&');
	if (query.includes('&')) return query.replace(/&/g, 'and');
	return null;
}

/**
 * Placeholder records: no votes and no release date. TMDB carries a few of
 * these per popular title, and an exact name match on one of them would
 * otherwise outrank the real series.
 */
const isPlaceholder = (item: TmdbItem) =>
	!item.vote_count && !(item.release_date || item.first_air_date);

async function fetchTmdb(query: string, key: string): Promise<TmdbItem[]> {
	const url = new URL(`${BASE}/search/multi`);
	url.searchParams.set('query', query);
	url.searchParams.set('include_adult', 'false');

	const response = await fetch(url, authorize(url, key));
	if (!response.ok) return [];

	const payload = (await response.json()) as { results?: TmdbItem[] };
	return (payload.results ?? []).filter((item) => item.media_type !== 'person');
}

export async function searchTmdb(query: string): Promise<SearchResult[]> {
	const key = tmdbKey();
	if (!key) return [];

	try {
		const byId = new Map<string, TmdbItem>();
		const collect = (items: TmdbItem[]) => {
			for (const item of items) byId.set(`${item.media_type}:${item.id}`, item);
		};

		const swapped = conjunctionVariant(query);
		const [first, second] = await Promise.all([
			fetchTmdb(query, key),
			swapped ? fetchTmdb(swapped, key) : Promise.resolve([])
		]);

		collect(first);
		collect(second);

		// Still nothing? The title probably uses punctuation we didn't type.
		if (byId.size === 0) {
			for (const variant of punctuationVariants(query)) {
				const attempt = await fetchTmdb(variant, key);
				if (attempt.length > 0) {
					collect(attempt);
					break;
				}
			}
		}

		const results = [...byId.values()].filter((item) => !isPlaceholder(item));

		// Everything TMDB returned is handed back, NOT just the first handful.
		// "X-Men" (2000) comes back 14th in their ordering, so trimming here
		// threw the film away before it could ever be ranked.
		return results.map(toResult);
	} catch {
		return [];
	}
}

/** One TMDB record in the shape the rest of the app uses. */
function toResult(item: TmdbItem): SearchResult {
	const title = item.title ?? item.name ?? 'Untitled';
	const original = item.original_title ?? item.original_name ?? null;
	const { slug, confident } = categorize(item);

	return {
		key: `tmdb:${item.media_type}:${item.id}`,
		source: 'tmdb',
		sourceId: `${item.media_type}:${item.id}`,
		title,
		altTitle: original && original !== title ? original : null,
		year: yearOf(item.release_date ?? item.first_air_date),
		posterUrl: item.poster_path ? `${IMAGE}${item.poster_path}` : null,
		overview: plainText(item.overview),
		categorySlug: slug,
		confident,
		kind: item.media_type === 'movie' ? 'Movie' : 'TV',
		episodesTotal: null,
		runtimeMinutes: null,
		externalRating: item.vote_average ? item.vote_average : null,
		externalVotes: item.vote_count ?? null,
		popularity: scaleFame(item.vote_count ?? 0, item.popularity ?? 0)
	};
}

/**
 * What everyone else is watching this week.
 *
 * The browse page needs something to show before you've typed anything —
 * searching only helps when you already know what you're looking for, and the
 * point of that page is finding something you don't.
 */
export type BrowseMode = 'trending' | 'popular';

export async function trendingTmdb(
	kind: 'movie' | 'tv',
	page = 1,
	mode: BrowseMode = 'trending',
	region?: string
): Promise<SearchResult[]> {
	const key = tmdbKey();
	if (!key) return [];

	try {
		/**
		 * "This week" and "of all time" are different endpoints, not a sort.
		 *
		 * All-time orders by `vote_count`, not by TMDB's `popularity` — the
		 * same choice the search ranking makes, and for the same reason:
		 * popularity is a rolling this-week score, so sorting by it would just
		 * hand back trending again in a different order.
		 */
		const url =
			mode === 'popular'
				? new URL(`${BASE}/discover/${kind}`)
				: new URL(`${BASE}/trending/${kind}/week`);

		if (mode === 'popular') {
			url.searchParams.set('sort_by', 'vote_count.desc');
			url.searchParams.set('include_adult', 'false');
		}

		if (region) {
			url.searchParams.set('region', region);
			if (mode === 'popular') url.searchParams.set('watch_region', region);
		}

		url.searchParams.set('page', String(page));

		const response = await fetch(url, authorize(url, key));
		if (!response.ok) return [];

		const payload = (await response.json()) as { results?: TmdbItem[] };

		return (payload.results ?? [])
			// Neither endpoint reliably carries the field the mapping reads.
			.map((item) => ({ ...item, media_type: item.media_type ?? kind }))
			.filter((item) => !isPlaceholder(item))
			.map(toResult);
	} catch {
		return [];
	}
}

export interface TrendingPerson {
	id: number;
	name: string;
	photo: string | null;
	knownFor: string;
}

export async function trendingPeopleTmdb(): Promise<TrendingPerson[]> {
	const key = tmdbKey();
	if (!key) return [];

	try {
		const url = new URL(`${BASE}/trending/person/week`);

		const response = await fetch(url, authorize(url, key));
		if (!response.ok) return [];

		const payload = (await response.json()) as {
			results?: {
				id: number;
				name: string;
				profile_path?: string | null;
				known_for?: { title?: string; name?: string; media_type?: string }[];
			}[];
		};

		return (payload.results ?? [])
			.filter((p) => p.profile_path)
			.slice(0, 12)
			.map((p) => ({
				id: p.id,
				name: p.name,
				photo: `${IMAGE}${p.profile_path}`,
				knownFor: (p.known_for ?? [])
					.map((k) => k.title ?? k.name)
					.filter(Boolean)
					.slice(0, 2)
					.join(', ')
			}));
	} catch {
		return [];
	}
}

export async function fetchImdbId(
	title: string,
	type: 'movie' | 'tv'
): Promise<string | null> {
	const key = tmdbKey();
	if (!key) return null;

	try {
		const searchUrl = new URL(`${BASE}/search/${type}`);
		searchUrl.searchParams.set('query', title);
		const searchResp = await fetch(searchUrl, authorize(searchUrl, key));
		if (!searchResp.ok) return null;

		const searchData = (await searchResp.json()) as { results?: { id: number }[] };
		const item = searchData.results?.[0];
		if (!item) return null;

		if (type === 'movie') {
			const detailUrl = new URL(`${BASE}/movie/${item.id}`);
			const detailResp = await fetch(detailUrl, authorize(detailUrl, key));
			if (!detailResp.ok) return null;
			const detail = (await detailResp.json()) as { imdb_id?: string };
			return detail.imdb_id ?? null;
		}

		const extUrl = new URL(`${BASE}/tv/${item.id}/external_ids`);
		const extResp = await fetch(extUrl, authorize(extUrl, key));
		if (!extResp.ok) return null;
		const ext = (await extResp.json()) as { imdb_id?: string };
		return ext.imdb_id ?? null;
	} catch {
		return null;
	}
}

export async function fetchEnglishTitle(
	title: string,
	type: 'movie' | 'tv'
): Promise<string | null> {
	const key = tmdbKey();
	if (!key) return null;

	try {
		const searchUrl = new URL(`${BASE}/search/${type}`);
		searchUrl.searchParams.set('query', title);
		const searchResp = await fetch(searchUrl, authorize(searchUrl, key));
		if (!searchResp.ok) return null;

		const data = (await searchResp.json()) as {
			results?: { name?: string; title?: string; original_name?: string; original_title?: string }[];
		};
		const item = data.results?.[0];
		if (!item) return null;

		const eng = type === 'tv' ? item.name : item.title;
		if (eng && eng.toLowerCase() !== title.toLowerCase()) return eng;
		return null;
	} catch {
		return null;
	}
}

export async function fetchAlternativeTitles(
	title: string,
	type: 'movie' | 'tv'
): Promise<string[]> {
	const key = tmdbKey();
	if (!key) return [];

	try {
		const searchUrl = new URL(`${BASE}/search/${type}`);
		searchUrl.searchParams.set('query', title);
		const searchResp = await fetch(searchUrl, authorize(searchUrl, key));
		if (!searchResp.ok) return [];

		const data = (await searchResp.json()) as {
			results?: { name?: string; title?: string; original_name?: string; original_title?: string }[];
		};
		const item = data.results?.[0];
		if (!item) return [];

		const titles: string[] = [];
		const eng = type === 'tv' ? item.name : item.title;
		const orig = type === 'tv' ? item.original_name : item.original_title;
		if (eng && eng.toLowerCase() !== title.toLowerCase()) titles.push(eng);
		if (orig && orig.toLowerCase() !== title.toLowerCase() && orig !== eng) titles.push(orig);
		return titles;
	} catch {
		return [];
	}
}

export interface CastMember {
	id: number;
	name: string;
	character: string;
	photo: string | null;
}

export async function fetchCast(
	title: string,
	type: 'movie' | 'tv'
): Promise<CastMember[]> {
	const key = tmdbKey();
	if (!key) return [];

	try {
		const searchUrl = new URL(`${BASE}/search/${type}`);
		searchUrl.searchParams.set('query', title);
		const searchResp = await fetch(searchUrl, authorize(searchUrl, key));
		if (!searchResp.ok) return [];

		const searchData = (await searchResp.json()) as { results?: { id: number }[] };
		const item = searchData.results?.[0];
		if (!item) return [];

		const creditsUrl = new URL(`${BASE}/${type}/${item.id}/credits`);
		const creditsResp = await fetch(creditsUrl, authorize(creditsUrl, key));
		if (!creditsResp.ok) return [];

		const credits = (await creditsResp.json()) as {
			cast?: { id: number; name: string; character: string; profile_path?: string | null; order?: number }[];
		};

		return (credits.cast ?? [])
			.sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
			.slice(0, 30)
			.map((c) => ({
				id: c.id,
				name: c.name,
				character: c.character,
				photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null
			}));
	} catch {
		return [];
	}
}

export async function fetchEpisodeNames(
	showTitle: string,
	seasonNumber: number
): Promise<Record<number, string>> {
	const key = tmdbKey();
	if (!key) return {};

	try {
		const searchUrl = new URL(`${BASE}/search/tv`);
		searchUrl.searchParams.set('query', showTitle);
		const searchResp = await fetch(searchUrl, authorize(searchUrl, key));
		if (!searchResp.ok) return {};

		const searchData = (await searchResp.json()) as {
			results?: { id: number; name?: string }[];
		};
		const show = searchData.results?.[0];
		if (!show) return {};

		const seasonUrl = new URL(`${BASE}/tv/${show.id}/season/${seasonNumber}`);
		const seasonResp = await fetch(seasonUrl, authorize(seasonUrl, key));
		if (!seasonResp.ok) return {};

		const seasonData = (await seasonResp.json()) as {
			episodes?: { episode_number: number; name: string }[];
		};

		const names: Record<number, string> = {};
		for (const ep of seasonData.episodes ?? []) {
			if (ep.episode_number != null && ep.name) {
				names[ep.episode_number] = ep.name;
			}
		}
		return names;
	} catch {
		return {};
	}
}
