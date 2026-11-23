/**
 * This week (/new): what came out in the last seven days, and what's coming in the next seven.
 *
 *   - Your shows: library shows still airing, with an episode out in the last 7 days or due in
 *     the next 7 (TMDB's last/next episode, asked per show and kept 6 hours);
 *   - Anime: every episode that aired this week (AniList's airing schedule), most popular first,
 *     laid out by day;
 *   - New to stream / In cinemas: films released this week in this country (TMDB's release
 *     kinds: digital or disc, and cinema), most popular first;
 *   - New shows: series whose first episode aired this week;
 * Every list is kept a few hours, so opening the page again is instant.
 */
import { getOrderCache, saveOrderCache, followedShows, tvLibrary } from './db/queries';
import { tmdbGet } from './metadata/tmdb';
import { anilistResting, anilistSaidWait } from './metadata/anilistNodes';
import { watchRegion } from './metadata/providers';
import { currentProfile, MAIN_PROFILE } from './profile';

const HOUR = 60 * 60 * 1000;
const IMAGE = 'https://image.tmdb.org/t/p/';

export type WeekList = { items: WeekItem[]; failed: boolean };

export type WeekItem = {
	key: string;
	title: string;
	year: number | null;
	poster: string | null;
	backdrop: string | null;
	href: string;
	/** Its day (YYYY-MM-DD), in this computer's time. */
	date: string;
	/** "S2 E7", "Episode 12": what came out. */
	what: string;
	overview: string;
	popularity: number;
};

const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The week this page covers: the last 7 days up to today, and the 7 after. */
export function weekWindow(now = new Date()) {
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const start = new Date(today);
	start.setDate(start.getDate() - 6);
	const ahead = new Date(today);
	ahead.setDate(ahead.getDate() + 7);
	return { start: day(start), today: day(today), ahead: day(ahead), startMs: start.getTime(), todayEndMs: today.getTime() + 24 * HOUR };
}

/** `fn` over every one of `things`, at most `size` at once, the next starting as soon as one ends. */
async function eachLimited<T>(things: T[], size: number, fn: (thing: T) => Promise<void>): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (next < things.length) await fn(things[next++]);
	};
	await Promise.all(Array.from({ length: Math.min(size, things.length) }, worker));
}

/** A kept answer, or a new one (kept `hours`); a failed ask (null) isn't kept. */
async function kept<T>(key: string, hours: number, make: () => Promise<T | null>, canKeep = (_value: T) => true, options: { stale?: boolean } = {}): Promise<T | null> {
	const hit = getOrderCache(key);
	if (hit && Date.now() - hit.at < hours * HOUR) return hit.value as T;
	const value = await make().catch(() => null);
	if (value !== null && canKeep(value)) saveOrderCache(key, value, Date.now());
	return value ?? (options.stale === false ? null : ((hit?.value as T) ?? null));
}

const tmdbHref = (kind: 'movie' | 'tv', id: number) => `/title/tmdb/${encodeURIComponent(`${kind}:${id}`)}`;

type TmdbListItem = {
	id: number;
	title?: string;
	name?: string;
	release_date?: string;
	first_air_date?: string;
	poster_path?: string | null;
	backdrop_path?: string | null;
	overview?: string;
	popularity?: number;
	original_language?: string;
	genre_ids?: number[];
};

function fromTmdb(kind: 'movie' | 'tv', r: TmdbListItem, what: string): WeekItem {
	const date = (kind === 'movie' ? r.release_date : r.first_air_date) ?? '';
	return {
		key: `tmdb:${kind}:${r.id}`,
		title: r.title ?? r.name ?? 'Untitled',
		year: date ? Number(date.slice(0, 4)) : null,
		poster: r.poster_path ? `${IMAGE}w342${r.poster_path}` : null,
		backdrop: r.backdrop_path ? `${IMAGE}w1280${r.backdrop_path}` : null,
		href: tmdbHref(kind, r.id),
		date,
		what,
		overview: r.overview ?? '',
		popularity: r.popularity ?? 0
	};
}

type FilmDates = { results: { iso_3166_1: string; release_dates: { type: number; release_date: string }[] }[] };
const filmDates = (id: string) => kept(`week-film-dates|${id}`, 6, () => tmdbGet<FilmDates>(`/movie/${id}/release_dates`), undefined, { stale: false });
const firstRelease = (releases: FilmDates, types: number[], region?: string) => releases.results
	.filter((r) => !region || r.iso_3166_1 === region)
	.flatMap((r) => r.release_dates)
	.filter((r) => types.includes(r.type))
	.map((r) => r.release_date.slice(0, 10))
	.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
	.sort()[0];

/** First digital/disc release anywhere, or first cinema release in the watch region. */
export function newFilms(types: '4|5' | '2|3'): Promise<WeekItem[] | null> {
	const w = weekWindow();
	const region = watchRegion();
	return kept(`week-films-first|${types}|${region}|${w.today}`, 6, async () => {
		const answer = await tmdbGet<{ results: TmdbListItem[] }>('/discover/movie', {
			...(types === '2|3' ? { region } : {}),
			with_release_type: types,
			'release_date.gte': w.start,
			'release_date.lte': w.today,
			sort_by: 'popularity.desc',
			include_adult: 'false',
			'vote_count.gte': types === '4|5' ? '5' : '0'
		});
		if (!answer) return null;
		const items = answer.results.filter((r) => r.poster_path).slice(0, 20).map((r) => fromTmdb('movie', r, types === '4|5' ? 'To stream' : 'In cinemas'));
		const releaseTypes = types.split('|').map(Number);
		const released = new Set<string>();
		let failed = false;
		const dateFor = async (item: WeekItem) => {
			const id = item.key.split(':')[2];
			const releases = await filmDates(id);
			if (!releases) {
				failed = true;
				return;
			}
			const date = firstRelease(releases, releaseTypes, types === '2|3' ? region : undefined);
			if (date && date >= w.start && date <= w.today) {
				item.date = date;
				released.add(item.key);
			}
		};
		await eachLimited(items, 6, dateFor);
		return failed ? null : items.filter((item) => released.has(item.key));
	}, undefined, { stale: false });
}

/** Series whose first episode aired this week (not news or talk shows). */
export function newShows(): Promise<WeekItem[] | null> {
	const w = weekWindow();
	return kept(`week-shows|${w.today}`, 6, async () => {
		const answer = await tmdbGet<{ results: TmdbListItem[] }>('/discover/tv', {
			'first_air_date.gte': w.start,
			'first_air_date.lte': w.today,
			sort_by: 'popularity.desc',
			without_genres: '10763,10767',
			include_adult: 'false'
		});
		if (!answer) return null;
		return answer.results.filter((r) => r.poster_path && r.backdrop_path).slice(0, 20).map((r) => fromTmdb('tv', r, 'Premiere'));
	});
}

/* ------------------------------------------------------------ anime by day */

const AIRING = `
query ($from: Int, $to: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
      episode
      airingAt
      media {
        id
        isAdult
        popularity
        countryOfOrigin
        format
        title { romaji english }
        coverImage { large }
        bannerImage
        startDate { year }
        description(asHtml: false)
      }
    }
  }
}`;

type Airing = {
	episode: number;
	airingAt: number;
	media: {
		id: number;
		isAdult: boolean;
		popularity: number;
		countryOfOrigin: string;
		format: string;
		title: { romaji: string | null; english: string | null };
		coverImage: { large: string | null };
		bannerImage: string | null;
		startDate: { year: number | null };
		description: string | null;
	};
};

/** Every anime episode that aired in the last 7 days, popular ones only (not shorts or adult). */
export function animeThisWeek(): Promise<WeekList | null> {
	const w = weekWindow();
	// Kept 3 hours (AniList allows only a few asks a minute).
	return kept<WeekList>(`week-anime-complete|${w.today}`, 3, async () => {
		if (anilistResting()) return null;
		const all: Airing[] = [];
		let failed = true;
		const to = Math.floor(Date.now() / 1000);
		for (let page = 1; page <= 20; page++) {
			try {
				const resp = await fetch('https://graphql.anilist.co', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
					body: JSON.stringify({ query: AIRING, variables: { from: Math.floor(w.startMs / 1000), to, page } }),
					signal: AbortSignal.timeout(10000)
				});
				if (resp.status === 429) {
					anilistSaidWait(resp);
					break;
				}
				if (!resp.ok) break;
				const data = (await resp.json()) as { errors?: unknown[]; data?: { Page?: { pageInfo: { hasNextPage: boolean }; airingSchedules: Airing[] } } };
				const got = data.data?.Page;
				if (data.errors?.length || !got?.pageInfo || !Array.isArray(got.airingSchedules)) break;
				all.push(...got.airingSchedules);
				if (!got.pageInfo.hasNextPage) {
					failed = false;
					break;
				}
			} catch {
				break;
			}
		}
		const items = all
			.filter((a) => !a.media.isAdult && a.media.countryOfOrigin === 'JP' && a.media.popularity >= 3000 && a.media.format !== 'TV_SHORT')
			.map((a) => {
				const when = new Date(a.airingAt * 1000);
				return {
					key: `anilist:${a.media.id}:${a.episode}`,
					title: a.media.title.english || a.media.title.romaji || 'Untitled',
					year: a.media.startDate.year,
					poster: a.media.coverImage.large,
					backdrop: a.media.bannerImage,
					href: `/title/anilist/${a.media.id}`,
					date: day(when),
					what: `Episode ${a.episode}`,
					overview: (a.media.description ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
					popularity: a.media.popularity
				} satisfies WeekItem;
			})
			.sort((a, b) => b.popularity - a.popularity);
		return { items, failed };
	}, (result) => !result.failed);
}

/* ------------------------------------------------------------ your shows */

type ShowDetails = {
	name: string;
	poster_path: string | null;
	backdrop_path: string | null;
	popularity: number;
	last_episode_to_air: Episode | null;
	next_episode_to_air: Episode | null;
};
type Episode = { air_date: string | null; season_number: number; episode_number: number; name: string; still_path: string | null; overview: string };

/**
 * Library shows still airing (not dropped or finished-and-ended) with an episode out in the last
 * 7 days (`out`) or due in the next 7 (`soon`). One TMDB ask per show, kept 6 hours, a few at once.
 */
export async function yourShows(shows = followedShows()): Promise<{ out: WeekItem[]; soon: WeekItem[]; failed: boolean }> {
	const w = weekWindow();
	const out: WeekItem[] = [];
	const soon: WeekItem[] = [];
	let failed = false;
	const ask = async (show: { id: number; title: string; tmdb: number }) => {
		const d = await kept<ShowDetails>(`week-show|${show.tmdb}`, 6, () => tmdbGet<ShowDetails>(`/tv/${show.tmdb}`));
		if (!d) {
			failed = true;
			return;
		}
		const item = (e: Episode): WeekItem => ({
			key: `tmdb:tv:${show.tmdb}:${e.season_number}:${e.episode_number}`,
			title: show.title,
			year: null,
			poster: d.poster_path ? `${IMAGE}w342${d.poster_path}` : null,
			backdrop: e.still_path ? `${IMAGE}w780${e.still_path}` : d.backdrop_path ? `${IMAGE}w780${d.backdrop_path}` : null,
			href: `/entry/${show.id}`,
			date: e.air_date ?? '',
			what: `S${e.season_number} E${e.episode_number}${e.name && !/^episode \d+$/i.test(e.name) ? ` · ${e.name}` : ''}`,
			overview: e.overview,
			popularity: d.popularity
		});
		const last = d.last_episode_to_air;
		const next = d.next_episode_to_air;
		if (last?.air_date && last.air_date >= w.start && last.air_date <= w.today) out.push(item(last));
		if (next?.air_date && next.air_date > w.today && next.air_date <= w.ahead) soon.push(item(next));
	};
	await eachLimited(shows, 6, ask);
	out.sort((a, b) => b.date.localeCompare(a.date));
	soon.sort((a, b) => a.date.localeCompare(b.date));
	return { out, soon, failed };
}

export async function fromWatchList(): Promise<WeekList> {
	const w = weekWindow();
	const followed = new Set(currentProfile() === MAIN_PROFILE ? followedShows().map((show) => `tv:${show.tmdb}`) : []);
	const planned = tvLibrary().filter((item) => item.status === 'planned' && item.source === 'tmdb'
		&& /^(movie|tv):\d+$/.test(item.sourceId ?? '') && !followed.has(item.sourceId!)).slice(0, 80);
	const shows = await yourShows(planned.filter((item) => item.sourceId!.startsWith('tv:'))
		.map((item) => ({ id: item.id, title: item.title, tmdb: Number(item.sourceId!.slice(3)) })));
	const items = [...shows.out, ...shows.soon].map((item) => ({ ...item, href: tmdbHref('tv', Number(item.key.split(':')[2])) }));
	let failed = shows.failed;
	const films = planned.filter((item) => item.sourceId!.startsWith('movie:'));
	const ask = async (film: typeof films[number]) => {
		const id = film.sourceId!.slice(6);
		const releases = await filmDates(id);
		if (!releases) { failed = true; return; }
		const date = firstRelease(releases, [4, 5]);
		if (!date || date < w.start || date > w.ahead) return;
		items.push({ key: `tmdb:movie:${id}`, title: film.title, year: film.year, poster: film.posterUrl,
			backdrop: null, href: tmdbHref('movie', Number(id)), date, what: 'To stream', overview: film.overview ?? '', popularity: 0 });
	};
	await eachLimited(films, 6, ask);
	items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
	return { items, failed };
}
