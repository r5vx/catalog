import { env } from '$env/dynamic/private';
import { readSettings } from '../settings';
import { getOrderCache, saveOrderCache } from '../db/queries';
import { plainText, fameScore, normalizeTitle, type SearchResult } from './types';

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

/** A plain TMDB GET, or null without a key or on any failure. */
export async function tmdbGet<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
	const key = tmdbKey();
	if (!key) return null;
	const url = new URL(`${BASE}${path}`);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	try {
		const resp = await fetch(url, { ...authorize(url, key), signal: AbortSignal.timeout(10000) });
		return resp.ok ? ((await resp.json()) as T) : null;
	} catch {
		return null;
	}
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
const PHONETIC_SWAPS: [string, string][] = [
	['aw', 'au'], ['au', 'aw'], ['ee', 'ea'], ['ea', 'ee'],
	['oo', 'ou'], ['ou', 'oo'], ['ei', 'ie'], ['ie', 'ei'],
	['ck', 'k'], ['k', 'ck'], ['ph', 'f'], ['f', 'ph'],
];

function phoneticVariant(query: string): string | null {
	if (query.length < 4) return null;
	for (const [from, to] of PHONETIC_SWAPS) {
		if (query.includes(from)) return query.replace(from, to);
	}
	return null;
}

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

async function fetchTmdbTyped(query: string, key: string): Promise<TmdbItem[]> {
	const results: TmdbItem[] = [];
	for (const type of ['movie', 'tv'] as const) {
		const url = new URL(`${BASE}/search/${type}`);
		url.searchParams.set('query', query);
		url.searchParams.set('include_adult', 'false');
		try {
			const response = await fetch(url, authorize(url, key));
			if (!response.ok) continue;
			const payload = (await response.json()) as { results?: TmdbItem[] };
			for (const item of payload.results ?? []) {
				results.push({ ...item, media_type: type });
			}
		} catch {}
	}
	return results;
}

export async function searchTmdb(query: string, fuzzy = false): Promise<SearchResult[]> {
	const key = tmdbKey();
	if (!key) return [];

	try {
		const byId = new Map<string, TmdbItem>();
		const collect = (items: TmdbItem[]) => {
			for (const item of items) byId.set(`${item.media_type}:${item.id}`, item);
		};

		const swapped = conjunctionVariant(query);
		const phonetic = fuzzy ? phoneticVariant(query) : null;
		const noSpaces = /\s/.test(query) ? query.replace(/\s+/g, '') : null;
		const prefix = !(/\s/.test(query)) && query.length >= 4 ? query.slice(0, 3) : null;
		const searches: Promise<TmdbItem[]>[] = [
			fetchTmdb(query, key),
			fetchTmdbTyped(query, key),
			swapped ? fetchTmdb(swapped, key) : Promise.resolve([]),
			phonetic ? fetchTmdb(phonetic, key) : Promise.resolve([]),
			noSpaces ? fetchTmdb(noSpaces, key) : Promise.resolve([]),
			prefix ? fetchTmdbTyped(prefix, key) : Promise.resolve([])
		];
		const batched = await Promise.all(searches);
		for (const batch of batched) collect(batch);

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

		if (fuzzy) {
			// Compound word with no spaces? Try splitting it.
			if (byId.size === 0 && !/\s/.test(query) && query.length > 6) {
				for (let i = 3; i <= query.length - 3; i++) {
					const split = query.slice(0, i) + ' ' + query.slice(i);
					const attempt = await fetchTmdb(split, key);
					if (attempt.length > 0) { collect(attempt); break; }
				}
			}

			// Misspelled words? Try dropping each word and searching the rest.
			if (byId.size === 0 && query.includes(' ')) {
				const words = query.split(/\s+/);
				if (words.length >= 2) {
					for (let i = 0; i < words.length; i++) {
						const partial = words.filter((_, j) => j !== i).join(' ');
						if (partial.length < 3) continue;
						const attempt = await fetchTmdb(partial, key);
						if (attempt.length > 0) { collect(attempt); break; }
					}
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
		kind: slug === 'anime' ? 'Anime' : (item.media_type === 'movie' ? 'Movie' : 'TV'),
		episodesTotal: null,
		runtimeMinutes: null,
		externalRating: item.vote_average ? item.vote_average : null,
		externalVotes: item.vote_count ?? null,
		popularity: scaleFame(item.vote_count ?? 0, item.popularity ?? 0),
		unreleased: (item.release_date ?? item.first_air_date ?? '') > new Date().toISOString().slice(0, 10)
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

export type BrowseSort = 'vote_count' | 'vote_average' | 'popularity' | 'release_date_desc' | 'release_date_asc';

export interface BrowseFilters {
	yearFrom?: number;
	yearTo?: number;
	sort?: BrowseSort;
	genre?: number;
}

export async function trendingTmdb(
	kind: 'movie' | 'tv',
	page = 1,
	mode: BrowseMode = 'trending',
	region?: string,
	filters?: BrowseFilters
): Promise<SearchResult[]> {
	const key = tmdbKey();
	if (!key) return [];

	try {
		const hasFilters = filters && (filters.yearFrom || filters.yearTo || filters.sort || filters.genre);
		const useDiscover = mode === 'popular' || hasFilters;

		const url = useDiscover
			? new URL(`${BASE}/discover/${kind}`)
			: new URL(`${BASE}/trending/${kind}/week`);

		if (useDiscover) {
			const sortMap: Record<BrowseSort, string> = {
				vote_count: 'vote_count.desc',
				vote_average: 'vote_average.desc',
				popularity: 'popularity.desc',
				release_date_desc: kind === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc',
				release_date_asc: kind === 'movie' ? 'primary_release_date.asc' : 'first_air_date.asc'
			};
			const sortBy = filters?.sort ? sortMap[filters.sort] : 'vote_count.desc';
			url.searchParams.set('sort_by', sortBy);
			url.searchParams.set('include_adult', 'false');

			if (filters?.sort === 'vote_average') {
				url.searchParams.set('vote_count.gte', '200');
			} else if (filters?.sort === 'release_date_desc' || filters?.sort === 'release_date_asc') {
				url.searchParams.set('vote_count.gte', '5');
			} else if (!filters?.sort || filters.sort === 'vote_count') {
				url.searchParams.set('vote_count.gte', '300');
			}

			if (!hasFilters || !filters?.sort || filters.sort === 'release_date_desc' || filters.sort === 'release_date_asc') {
				url.searchParams.set('with_original_language', 'en|ja|ko|fr|es|de|it|pt|hi|zh');
			}

			if (filters?.genre) {
				url.searchParams.set('with_genres', String(filters.genre));
			}

			if (filters?.yearFrom) {
				const dateKey = kind === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte';
				url.searchParams.set(dateKey, `${filters.yearFrom}-01-01`);
			}
			if (filters?.yearTo) {
				const dateKey = kind === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte';
				url.searchParams.set(dateKey, `${filters.yearTo}-12-31`);
			}

			if (filters?.sort === 'release_date_desc' && !filters?.yearTo) {
				const dateKey = kind === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte';
				url.searchParams.set(dateKey, new Date().toISOString().slice(0, 10));
			}
		}

		if (region && !useDiscover) {
			url.searchParams.set('region', region);
		}

		url.searchParams.set('page', String(page));

		const response = await fetch(url, authorize(url, key));
		if (!response.ok) return [];

		const payload = (await response.json()) as { results?: TmdbItem[] };

		const today = new Date().toISOString().slice(0, 10);
		return (payload.results ?? [])
			.map((item) => ({ ...item, media_type: item.media_type ?? kind }))
			.filter((item) => !isPlaceholder(item))
			.filter((item) => {
				const d = item.release_date ?? item.first_air_date ?? '';
				return !d || d <= today;
			})
			.filter((item) => {
				if (useDiscover) return true;
				return (item.vote_count ?? 0) >= 50;
			})
			.map(toResult)
			.filter((r) => r.categorySlug !== 'anime');
	} catch {
		return [];
	}
}

/**
 * Anime for Browse, from TMDB rather than AniList: TMDB has it all (a Japanese, animated title
 * is anime — categorize() above), answers in a tenth of a second and doesn't turn Catalog away
 * after thirty questions a minute, which AniList did, and held up whatever was clicked next.
 *
 * What people are watching is what's airing (an episode in the last two months) and most
 * popular, with films from the last year among them; all time is the most voted. Children's
 * series (Doraemon, decades of it) are left out, and so is anything TMDB marks ecchi, hentai or
 * softcore: "I'm Dating a Dark Summoner" turned up on the TV at home. Searching still finds them.
 */
const NOT_FOR_BROWSING = [195669, 285672, 198385, 384581, 155477, 256466, 378816].join('|');
const KIDS_SERIES = '10762';

/** A film genre as TMDB numbers it for series (they differ), or a keyword where series have none. */
const SERIES_GENRE: Record<number, { genre?: string; keyword?: string }> = {
	28: { genre: '10759' }, 12: { genre: '10759' }, 878: { genre: '10765' }, 14: { genre: '10765' },
	35: { genre: '35' }, 18: { genre: '18' }, 9648: { genre: '9648' }, 80: { genre: '80' },
	10751: { genre: '10751' }, 99: { genre: '99' }, 37: { genre: '37' }, 10752: { genre: '10768' },
	10749: { keyword: '9840' }, 27: { keyword: '315058' }
};

export async function trendingAnimeTmdb(page = 1, mode: BrowseMode = 'trending', filters?: BrowseFilters): Promise<SearchResult[]> {
	if (!tmdbKey()) return [];
	const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
	const today = daysAgo(0);
	const sortBy = (kind: 'movie' | 'tv') => {
		const date = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
		switch (filters?.sort) {
			case 'vote_average': return 'vote_average.desc';
			case 'popularity': return 'popularity.desc';
			case 'release_date_desc': return `${date}.desc`;
			case 'release_date_asc': return `${date}.asc`;
			case 'vote_count': return 'vote_count.desc';
			default: return mode === 'popular' ? 'vote_count.desc' : 'popularity.desc';
		}
	};
	const common = (kind: 'movie' | 'tv'): Record<string, string> => {
		const date = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
		const params: Record<string, string> = {
			page: String(page),
			with_original_language: 'ja',
			include_adult: 'false',
			without_keywords: NOT_FOR_BROWSING,
			sort_by: sortBy(kind),
			'vote_count.gte': filters?.sort === 'vote_average' ? '200' : filters?.sort?.startsWith('release') ? '5' : '20'
		};
		if (filters?.yearFrom) params[`${date}.gte`] = `${filters.yearFrom}-01-01`;
		params[`${date}.lte`] = filters?.yearTo ? `${filters.yearTo}-12-31` : today;
		return params;
	};

	const series = common('tv');
	series.with_genres = '16';
	series.without_genres = KIDS_SERIES;
	const films = common('movie');
	films.with_genres = '16';
	if (filters?.genre) {
		films.with_genres = `16,${filters.genre}`;
		const asSeries = SERIES_GENRE[filters.genre];
		if (asSeries?.genre) series.with_genres = `16,${asSeries.genre}`;
		else if (asSeries?.keyword) series.with_keywords = asSeries.keyword;
	}
	const browsingNow = mode === 'trending' && !filters?.sort && !filters?.yearFrom && !filters?.yearTo;
	if (browsingNow) {
		series['air_date.gte'] = daysAgo(60);
		// Known well enough to be what people are watching (Chibi Maruko-chan airs every week too).
		series['vote_count.gte'] = '100';
		films['primary_release_date.gte'] = daysAgo(365);
	}
	// A genre series can't be asked for by (thriller, say): films only.
	const askSeries = !filters?.genre || Boolean(SERIES_GENRE[filters.genre]);

	const [shows, movies] = await Promise.all([
		askSeries ? tmdbGet<{ results?: TmdbItem[] }>('/discover/tv', series) : Promise.resolve(null),
		tmdbGet<{ results?: TmdbItem[] }>('/discover/movie', films)
	]);
	const asResults = (items: TmdbItem[] | undefined, kind: 'movie' | 'tv') =>
		(items ?? [])
			.map((item) => ({ ...item, media_type: kind }))
			.filter((item) => !isPlaceholder(item))
			.map(toResult)
			.map((r) => ({ ...r, categorySlug: 'anime' as const, kind: kind === 'movie' ? 'Movie' : 'Anime', confident: true }));
	// Three series to a film, as there are about that many more of them.
	const a = asResults(shows?.results, 'tv');
	const b = asResults(movies?.results, 'movie');
	const out: SearchResult[] = [];
	while (a.length || b.length) {
		out.push(...a.splice(0, 3));
		if (b.length) out.push(b.shift()!);
	}
	return out;
}

export interface TrendingPerson {
	id: number;
	name: string;
	photo: string | null;
	knownFor: string;
}

/**
 * Who's actually trending: the leads of this week's most-watched films and series, each counted
 * by how high their titles are and how high they're billed. TMDB's own "popular people" list is
 * easily pushed about (actors from two 1998 films at the top), and its "trending people" is
 * mostly adult performers. Worked out twice a day; the last answer shows meanwhile.
 */
let trendingPeople: { list: TrendingPerson[]; at: number } | null = null;
let workingOutPeople: Promise<TrendingPerson[]> | null = null;

export async function trendingPeopleTmdb(): Promise<TrendingPerson[]> {
	if (!tmdbKey()) return [];
	if (!trendingPeople) {
		const kept = getOrderCache('trending-people');
		if (kept) trendingPeople = { list: kept.value as TrendingPerson[], at: kept.at };
	}
	const fresh = trendingPeople && Date.now() - trendingPeople.at < 12 * 60 * 60 * 1000;
	if (!fresh) {
		workingOutPeople ??= workOutTrendingPeople()
			.then((list) => {
				if (list.length) {
					trendingPeople = { list, at: Date.now() };
					saveOrderCache('trending-people', list, Date.now());
				}
				return list;
			})
			.finally(() => (workingOutPeople = null));
	}
	if (trendingPeople?.list.length) return trendingPeople.list;
	return workingOutPeople ?? [];
}

async function workOutTrendingPeople(): Promise<TrendingPerson[]> {
	type Credit = { id: number; name: string; profile_path?: string | null; order?: number; known_for_department?: string };
	type Title = { id: number; title?: string; name?: string; vote_count?: number; adult?: boolean };

	const [films, series] = await Promise.all([
		tmdbGet<{ results?: Title[] }>('/trending/movie/week'),
		tmdbGet<{ results?: Title[] }>('/trending/tv/week')
	]);
	// Real releases only (a vote count), the top twenty of each, in order.
	const titles = [
		...(films?.results ?? []).map((t, rank) => ({ ...t, kind: 'movie', rank })),
		...(series?.results ?? []).map((t, rank) => ({ ...t, kind: 'tv', rank }))
	].filter((t) => !t.adult && (t.vote_count ?? 0) >= 50);

	const people = new Map<number, { person: TrendingPerson; score: number; titles: string[] }>();
	const casts = await Promise.all(
		titles.map((t) =>
			tmdbGet<{ cast?: Credit[] }>(t.kind === 'movie' ? `/movie/${t.id}/credits` : `/tv/${t.id}/aggregate_credits`).then(
				(credits) => ({ t, cast: (credits?.cast ?? []).slice(0, 6) })
			)
		)
	);
	for (const { t, cast } of casts) {
		cast.forEach((c, billed) => {
			if (!c.profile_path || (c.known_for_department && c.known_for_department !== 'Acting')) return;
			const score = (25 - t.rank) * (6 - billed);
			const known = people.get(c.id);
			const name = t.title ?? t.name ?? '';
			if (known) {
				known.score += score;
				if (name && !known.titles.includes(name)) known.titles.push(name);
			} else {
				people.set(c.id, {
					person: { id: c.id, name: c.name, photo: `${IMAGE}${c.profile_path}`, knownFor: '' },
					score,
					titles: name ? [name] : []
				});
			}
		});
	}
	return [...people.values()]
		.sort((a, b) => b.score - a.score)
		.slice(0, 40)
		.map(({ person, titles }) => ({ ...person, knownFor: titles.slice(0, 2).join(', ') }));
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

		const searchData = (await searchResp.json()) as { results?: { id: number; title?: string; name?: string }[] };
		// The one named exactly that, else the top one: TMDB's top hit for "Re:ZERO … The Frozen
		// Bond" is the better-known Memory Snow.
		const same = (t?: string) => Boolean(t) && normalizeTitle(t!) === normalizeTitle(title);
		const item = searchData.results?.find((r) => same(r.title ?? r.name)) ?? searchData.results?.[0];
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

export async function fetchEpisodeCast(
	title: string,
	season: number,
	episode: number
): Promise<CastMember[]> {
	const key = tmdbKey();
	if (!key) return [];

	try {
		const searchUrl = new URL(`${BASE}/search/tv`);
		searchUrl.searchParams.set('query', title);
		const searchResp = await fetch(searchUrl, authorize(searchUrl, key));
		if (!searchResp.ok) return [];

		const searchData = (await searchResp.json()) as { results?: { id: number }[] };
		const item = searchData.results?.[0];
		if (!item) return [];

		const epCreditsUrl = new URL(`${BASE}/tv/${item.id}/season/${season}/episode/${episode}/credits`);
		const epResp = await fetch(epCreditsUrl, authorize(epCreditsUrl, key));
		if (!epResp.ok) return [];

		const credits = (await epResp.json()) as {
			cast?: { id: number; name: string; character: string; profile_path?: string | null; order?: number }[];
			guest_stars?: { id: number; name: string; character: string; profile_path?: string | null; order?: number }[];
		};

		const mainCast = (credits.cast ?? []).map(c => ({ ...c, isGuest: false }));
		const guests = (credits.guest_stars ?? []).map(c => ({ ...c, isGuest: true }));
		const all = [...mainCast, ...guests];

		const seen = new Set<number>();
		const unique = all.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });

		return unique
			.sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
			.slice(0, 30)
			.map((c) => ({
				id: c.id,
				name: c.name,
				character: c.character + (c.isGuest ? ' (Guest)' : ''),
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
