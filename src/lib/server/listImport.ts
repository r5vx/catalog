/**
 * Bringing in what you've watched from another site (owner, 2026-11-20: "support for my anime list,
 * and maybe any other websites people store all the stuff they have watched on"): the Add page's
 * Import from a site (src/routes/import/list).
 *
 * - MyAnimeList, AniList and Kitsu: by username, from their public lists (no account or key here).
 * - Letterboxd and IMDb: from the export file those sites give you (neither has a public list
 *   anyone can read without a key of their own).
 *
 * Everything is matched to TMDB, as the library keeps it: one entry per show with its seasons
 * inside. Anime sites list each season apart (Re:Zero, Re:Zero 2nd Season, …), so the seasons of
 * one show come together as one entry, with the furthest season and episode reached, the status
 * that says the most, and the average score.
 */
import { searchAll } from './metadata';
import { tmdbGet, toResult } from './metadata/tmdb';
import type { SearchResult } from './metadata';

export type { ListSite } from '$lib/listImport';
import type { ListSite } from '$lib/listImport';
import { isFilm, seasonOf, type ListItem, type ListStatus as Status } from '$lib/listImport';
export type { ListItem };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const yearOf = (text: unknown) => {
	const m = String(text ?? '').match(/(19|20)\d{2}/);
	return m ? Number(m[0]) : null;
};
const tenth = (n: number | null) => (n === null || !Number.isFinite(n) || n <= 0 ? null : Math.round(Math.min(10, n) * 2) / 2);

export class ListProblem extends Error {}

/* ------------------------------------------------------------------ the sites */

/** MyAnimeList's own list page asks this for its rows, 300 at a time; a public list needs nothing more. */
async function fromMal(user: string): Promise<ListItem[]> {
	const STATUS: Record<number, Status> = { 1: 'watching', 2: 'completed', 3: 'paused', 4: 'dropped', 6: 'planned' };
	type Row = { anime_title: string; anime_title_eng?: string; anime_start_date_string?: string; anime_season?: { year?: number } | null; anime_media_type_string?: string; status: number; score: number; num_watched_episodes: number; is_rewatching?: number };
	// Its start date is month-day-two-digit-year ("10-20-99"); the season's year when it's given.
	const startYear = (row: Row) => {
		if (row.anime_season?.year) return row.anime_season.year;
		const m = String(row.anime_start_date_string ?? '').match(/(\d{2})$/);
		if (!m) return null;
		const yy = Number(m[1]);
		return yy > 40 ? 1900 + yy : 2000 + yy;
	};
	const items: ListItem[] = [];
	for (let offset = 0; offset < 6000; offset += 300) {
		const resp = await fetch(`https://myanimelist.net/animelist/${encodeURIComponent(user)}/load.json?status=7&offset=${offset}`, {
			headers: { 'User-Agent': UA, Accept: 'application/json' },
			signal: AbortSignal.timeout(20000)
		}).catch(() => null);
		if (!resp) throw new ListProblem("MyAnimeList couldn't be reached.");
		if (resp.status === 400 || resp.status === 404) throw new ListProblem("No public list for that name on MyAnimeList. Check the name, and that the list isn't private.");
		if (!resp.ok) throw new ListProblem(`MyAnimeList answered ${resp.status}. Try again in a minute.`);
		const rows = (await resp.json().catch(() => [])) as Row[];
		for (const row of rows) {
			items.push({
				title: row.anime_title_eng || row.anime_title,
				alt: row.anime_title_eng && row.anime_title_eng !== row.anime_title ? [row.anime_title] : [],
				year: startYear(row),
				kind: row.anime_media_type_string === 'Movie' ? 'movie' : 'anime',
				status: row.is_rewatching ? 'rewatching' : (STATUS[row.status] ?? 'completed'),
				score: tenth(row.score),
				progress: row.num_watched_episodes || null
			});
		}
		if (rows.length < 300) break;
		await new Promise((resolve) => setTimeout(resolve, 1500));
	}
	return items;
}

async function fromAnilist(user: string): Promise<ListItem[]> {
	const STATUS: Record<string, Status> = { CURRENT: 'watching', COMPLETED: 'completed', PAUSED: 'paused', DROPPED: 'dropped', PLANNING: 'planned', REPEATING: 'rewatching' };
	const query = `query ($user: String) { MediaListCollection(userName: $user, type: ANIME) { lists { entries { status score(format: POINT_10_DECIMAL) progress media { title { english romaji } startDate { year } format } } } } }`;
	const resp = await fetch('https://graphql.anilist.co', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({ query, variables: { user } }),
		signal: AbortSignal.timeout(20000)
	}).catch(() => null);
	if (!resp) throw new ListProblem("AniList couldn't be reached.");
	type Entry = { status: string; score: number; progress: number; media: { title: { english: string | null; romaji: string | null }; startDate: { year: number | null }; format: string | null } };
	const data = (await resp.json().catch(() => null)) as { data?: { MediaListCollection?: { lists: { entries: Entry[] }[] } }; errors?: { message: string }[] } | null;
	if (resp.status === 429) throw new ListProblem('AniList is busy. Try again in a minute.');
	if (data?.errors?.some((e) => /private/i.test(e.message))) throw new ListProblem("That AniList list is private. It can be made public in AniList's settings.");
	if (!data?.data?.MediaListCollection) throw new ListProblem("No list for that name on AniList. Check the name.");
	return data.data.MediaListCollection.lists.flatMap((list) =>
		list.entries.map((e) => ({
			title: e.media.title.english || e.media.title.romaji || '',
			alt: e.media.title.english && e.media.title.romaji ? [e.media.title.romaji] : [],
			year: e.media.startDate.year ?? null,
			kind: e.media.format === 'MOVIE' ? ('movie' as const) : ('anime' as const),
			status: STATUS[e.status] ?? 'completed',
			score: tenth(e.score),
			progress: e.progress || null
		}))
	);
}

async function fromKitsu(user: string): Promise<ListItem[]> {
	const STATUS: Record<string, Status> = { current: 'watching', completed: 'completed', on_hold: 'paused', dropped: 'dropped', planned: 'planned' };
	const ask = async (path: string) => {
		const resp = await fetch(`https://kitsu.io/api/edge/${path}`, { headers: { Accept: 'application/vnd.api+json' }, signal: AbortSignal.timeout(20000) }).catch(() => null);
		if (!resp?.ok) throw new ListProblem("Kitsu couldn't be reached.");
		return resp.json();
	};
	const found = await ask(`users?filter[slug]=${encodeURIComponent(user)}`);
	const named = found.data?.length ? found : await ask(`users?filter[name]=${encodeURIComponent(user)}`);
	const id = named.data?.[0]?.id;
	if (!id) throw new ListProblem('No one by that name on Kitsu.');
	const items: ListItem[] = [];
	for (let offset = 0; offset < 5000; offset += 500) {
		const page = await ask(`library-entries?filter[userId]=${id}&filter[kind]=anime&include=anime&fields[anime]=canonicalTitle,titles,startDate,subtype&page[limit]=500&page[offset]=${offset}`);
		const anime = new Map<string, { canonicalTitle: string; titles?: Record<string, string>; startDate?: string; subtype?: string }>(
			(page.included ?? []).map((a: { id: string; attributes: never }) => [a.id, a.attributes])
		);
		for (const entry of page.data ?? []) {
			const a = anime.get(entry.relationships?.anime?.data?.id);
			if (!a) continue;
			const english = a.titles?.en || a.titles?.en_us || '';
			items.push({
				title: english || a.canonicalTitle,
				alt: english ? [a.canonicalTitle] : [],
				year: yearOf(a.startDate),
				kind: a.subtype === 'movie' ? 'movie' : 'anime',
				status: entry.attributes.reconsuming ? 'rewatching' : (STATUS[entry.attributes.status] ?? 'completed'),
				score: entry.attributes.ratingTwenty ? tenth(entry.attributes.ratingTwenty / 2) : null,
				progress: entry.attributes.progress || null
			});
		}
		if ((page.data ?? []).length < 500) break;
	}
	return items;
}

/** A CSV file's rows by their header names (quotes and commas inside them handled). */
function csvRows(text: string): Record<string, string>[] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	const src = text.replace(/^﻿/, '');
	for (let i = 0; i < src.length; i++) {
		const c = src[i];
		if (quoted) {
			if (c === '"' && src[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (c === '"') quoted = false;
			else cell += c;
		} else if (c === '"') quoted = true;
		else if (c === ',') {
			row.push(cell);
			cell = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && src[i + 1] === '\n') i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
		} else cell += c;
	}
	if (cell || row.length) {
		row.push(cell);
		rows.push(row);
	}
	const [head, ...rest] = rows;
	if (!head) return [];
	return rest.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/** Letterboxd's export: watched.csv, ratings.csv or diary.csv (films; ratings out of 5). */
function fromLetterboxd(csv: string): ListItem[] {
	const rows = csvRows(csv);
	if (!rows.length || !('Name' in rows[0])) throw new ListProblem("That isn't one of Letterboxd's export files. Pick watched.csv or ratings.csv from the export.");
	return rows.map((r) => ({
		title: r.Name,
		alt: [],
		year: yearOf(r.Year),
		kind: 'movie' as const,
		status: 'completed' as const,
		score: r.Rating ? tenth(Number(r.Rating) * 2) : null,
		progress: null
	}));
}

/** IMDb's export of your ratings (or a list, or the watchlist). */
function fromImdb(csv: string): ListItem[] {
	const rows = csvRows(csv);
	if (!rows.length || !('Const' in rows[0])) throw new ListProblem("That isn't an IMDb export. On IMDb: Your ratings → Export.");
	return rows
		.filter((r) => /^tt\d+$/.test(r.Const))
		.map((r) => {
			const type = (r['Title Type'] ?? '').toLowerCase();
			const rated = Number(r['Your Rating']);
			return {
				title: r.Title,
				alt: [],
				year: yearOf(r.Year),
				kind: /series|mini/.test(type) ? ('tv' as const) : ('movie' as const),
				// A watchlist export has no rating column: those are still to watch.
				status: 'Your Rating' in r ? ('completed' as const) : ('planned' as const),
				score: tenth(rated),
				progress: null,
				imdbId: r.Const
			};
		});
}

export async function loadList(site: ListSite, user: string, file: string): Promise<ListItem[]> {
	const name = user.trim().replace(/^@/, '').replace(/^https?:\/\/[^/]+\/(profile|user|users|animelist)\//i, '').split(/[/?#]/)[0];
	if ((site === 'mal' || site === 'anilist' || site === 'kitsu') && !/^[\w-]{2,40}$/.test(name)) throw new ListProblem('Type the username as it is on the site.');
	const items =
		site === 'mal' ? await fromMal(name) : site === 'anilist' ? await fromAnilist(name) : site === 'kitsu' ? await fromKitsu(name) : site === 'letterboxd' ? fromLetterboxd(file) : fromImdb(file);
	return items.filter((item) => item.title);
}

/* ------------------------------------------------------------------ matching */

async function optionsFor(item: ListItem): Promise<SearchResult[]> {
	if (item.imdbId) {
		type Found = { movie_results?: { id: number }[]; tv_results?: { id: number }[] };
		const found = await tmdbGet<Found>(`/find/${item.imdbId}`, { external_source: 'imdb_id' });
		const hit = found?.movie_results?.[0] ? { ...found.movie_results[0], media_type: 'movie' } : found?.tv_results?.[0] ? { ...found.tv_results[0], media_type: 'tv' } : null;
		if (hit) return [toResult(hit as never)];
	}
	const { base, season } = item.kind === 'movie' ? { base: item.title, season: null } : seasonOf(item.title);
	// A later season's year isn't the show's: searched without it.
	const year = item.kind === 'movie' || !season || season === 1 ? item.year : null;
	// (By TMDB's own type: an anime film's card says Anime, not Movie.)
	const wanted = (r: SearchResult) => (item.kind === 'movie') === isFilm(r);
	for (const name of [base, ...item.alt.map((a) => (item.kind === 'movie' ? a : seasonOf(a).base))]) {
		const found = (await searchAll(name, { year, limit: 5 }).catch(() => [])) as SearchResult[];
		const fitting = [...found.filter(wanted), ...found.filter((r) => !wanted(r))];
		if (fitting.length) return fitting;
	}
	return [];
}

/** Matches each line to TMDB, a few at a time: the best first, then the others to pick from. */
export async function matchItems(items: ListItem[]): Promise<{ item: ListItem; options: SearchResult[] }[]> {
	const out: { item: ListItem; options: SearchResult[] }[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: 4 }, async () => {
			while (next < items.length) {
				const at = next++;
				out[at] = { item: items[at], options: await optionsFor(items[at]).catch(() => []) };
			}
		})
	);
	return out;
}
