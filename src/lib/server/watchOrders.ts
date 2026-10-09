/**
 * Watch orders: a franchise's titles in release order, checked against the library.
 *
 * Two kinds. Hand-made lists ($lib/watchOrders) for franchises that mix films and series —
 * each title is looked up on TMDB for its date and poster. And TMDB "collections" (every
 * Harry Potter film, every John Wick…) which come complete from TMDB, films only.
 */
import { db } from './db/index';
import { watchedExtras, skippedTitles, getOrderCache, saveOrderCache, myWatchOrders } from './db/queries';
import { tmdbGet } from './metadata/tmdb';
import { normalizeTitle } from './metadata/types';
import { WATCH_ORDERS, POPULAR_COLLECTIONS, orderBySlug, type OrderItem } from '$lib/watchOrders';

export type OrderStatus = 'watched' | 'watching' | 'listed' | 'dropped' | 'none';
export type ItemKind = 'film' | 'series' | 'short' | 'special';

export type ResolvedItem = {
	key: string;
	title: string;
	season: number | null;
	type: 'movie' | 'tv';
	kind: ItemKind;
	/** Optional viewing (One-Shots): hidden unless asked for, and not counted. */
	extra: boolean;
	/** You chose to skip it: not up next, and not counted. */
	skipped: boolean;
	/** TMDB id as the library stores it, e.g. "movie:1726". */
	sourceId: string;
	date: string | null;
	year: number | null;
	posterUrl: string | null;
	backdropUrl: string | null;
	overview: string;
	entryId: number | null;
	status: OrderStatus;
	released: boolean;
};

export type FranchiseHit = {
	id: string;
	name: string;
	kind: 'list' | 'collection';
	posterUrl: string | null;
	/** How many titles, when known. */
	count: number | null;
};

type Found = { id: number; title: string; date: string | null; poster: string | null; backdrop: string | null; overview: string };

const POSTER = 'https://image.tmdb.org/t/p/w342';
const BACKDROP = 'https://image.tmdb.org/t/p/w1280';
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

/* ------------------------------------------------ remembering what TMDB said */

const memory = new Map<string, { value: unknown; at: number }>();
const refreshing = new Set<string>();

/**
 * Answers from the saved copy straight away, even an old one, and refreshes an old one in
 * the background — so a watch order opens instantly and still picks up new release dates.
 * `ask` returns undefined when TMDB couldn't be reached, which is never saved.
 */
async function remembered<T>(key: string, ask: () => Promise<T | null | undefined>, maxAge: (value: T | null) => number): Promise<T | null> {
	let saved = memory.get(key) as { value: T | null; at: number } | undefined;
	if (!saved) {
		saved = getOrderCache(key) as { value: T | null; at: number } | undefined;
		if (saved) memory.set(key, saved);
	}

	const refresh = async () => {
		const value = await ask();
		if (value !== undefined) {
			const at = Date.now();
			memory.set(key, { value, at });
			saveOrderCache(key, value, at);
		}
		return value;
	};

	if (!saved) return (await refresh()) ?? null;
	if (Date.now() - saved.at > maxAge(saved.value) && !refreshing.has(key)) {
		refreshing.add(key);
		refresh()
			.catch(() => {})
			.finally(() => refreshing.delete(key));
	}
	return saved.value;
}

/** Released titles hardly change; upcoming ones get their dates moved, so they're checked daily. */
function lookUpAge(found: Found | null): number {
	if (!found) return WEEK;
	const today = new Date().toISOString().slice(0, 10);
	return found.date && found.date <= today ? 30 * DAY : DAY;
}

/** Marvel's Netflix shows are listed as "Marvel's Daredevil" in some places and "Daredevil" in others. */
const comparable = (title: string) => normalizeTitle(title).replace(/^marvel s /, '');

function lookUp(item: OrderItem): Promise<Found | null> {
	const key = `title|${item.type}|${normalizeTitle(item.title)}|${item.year}|${item.season ?? 1}`;
	return remembered(key, () => askTmdb(item), lookUpAge);
}

async function askTmdb(item: OrderItem): Promise<Found | null | undefined> {
	type Hit = {
		id: number;
		title?: string;
		name?: string;
		release_date?: string;
		first_air_date?: string;
		poster_path?: string | null;
		backdrop_path?: string | null;
		overview?: string;
	};
	const search = await tmdbGet<{ results: Hit[] }>(`/search/${item.type}`, {
		query: item.title,
		...(item.type === 'movie' ? { year: String(item.year) } : { first_air_date_year: String(item.year) })
	});
	if (!search) return undefined; // couldn't ask — try again next time

	// Only a real name match. Falling back to "the first result" would quietly put the wrong film in.
	const want = comparable(item.title);
	const named = (r: Hit) => comparable(r.title ?? r.name ?? '');
	const hit =
		search.results.find((r) => named(r) === want) ??
		search.results.find((r) => named(r).includes(want) || want.includes(named(r)));

	let value: Found | null = null;
	if (hit) {
		value = {
			id: hit.id,
			title: hit.title ?? hit.name ?? item.title,
			date: (item.type === 'movie' ? hit.release_date : hit.first_air_date) || null,
			poster: hit.poster_path ? POSTER + hit.poster_path : null,
			backdrop: hit.backdrop_path ? BACKDROP + hit.backdrop_path : null,
			overview: hit.overview ?? ''
		};
		if (item.type === 'tv' && item.season && item.season > 1) {
			type Season = { season_number: number; air_date: string | null; poster_path: string | null; overview?: string };
			const tv = await tmdbGet<{ seasons?: Season[] }>(`/tv/${hit.id}`);
			if (!tv) return undefined;
			const season = tv?.seasons?.find((s) => s.season_number === item.season);
			if (!season) value = null;
			else {
				value.date = season.air_date || null;
				if (season.poster_path) value.poster = POSTER + season.poster_path;
				if (season.overview) value.overview = season.overview;
			}
		}
	} else {
		console.warn('[watch-orders] not on TMDB:', item.title, item.year, item.season ?? '');
	}
	return value;
}

type Owned = { id: number; title: string; year: number | null; status: string; source: string; sourceId: string | null; lastSeason: number | null };

function statusFor(entry: Owned | undefined, season: number | null): OrderStatus {
	if (!entry) return 'none';
	if (entry.status === 'completed') return 'watched';
	if (entry.status === 'dropped') return 'dropped';
	if (entry.status === 'watching') {
		// A later season you haven't reached yet isn't "in progress".
		if (season && entry.lastSeason) {
			if (entry.lastSeason > season) return 'watched';
			if (entry.lastSeason < season) return 'none';
		}
		return 'watching';
	}
	return 'listed';
}

type Base = Omit<ResolvedItem, 'entryId' | 'status' | 'released' | 'skipped'>;

/** Adds what the library knows, then sorts into release order (undated last). */
function finish(items: Base[]): ResolvedItem[] {
	const owned = db
		.prepare('SELECT id, title, year, status, source, source_id AS sourceId, last_season AS lastSeason FROM entries')
		.all() as unknown as Owned[];
	const bySource = new Map(owned.filter((e) => e.sourceId).map((e) => [`${e.source}:${e.sourceId}`, e]));
	const byTitle = new Map(owned.map((e) => [`${normalizeTitle(e.title)}|${e.year ?? ''}`, e]));
	const seenExtras = watchedExtras();
	const skipped = skippedTitles();
	const today = new Date().toISOString().slice(0, 10);

	return items
		.map((item) => {
			const entry = bySource.get(`tmdb:${item.sourceId}`) ?? byTitle.get(`${normalizeTitle(item.title)}|${item.year ?? ''}`);
			let status = statusFor(entry, item.season);
			if (status === 'none' && item.extra && seenExtras.has(item.sourceId)) status = 'watched';
			return {
				...item,
				entryId: entry?.id ?? null,
				status,
				skipped: skipped.has(item.key),
				released: Boolean(item.date && item.date <= today)
			};
		})
		.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}

const kindOf = (item: OrderItem): ItemKind => item.kind ?? (item.type === 'movie' ? 'film' : 'series');

async function resolveList(items: OrderItem[]): Promise<ResolvedItem[]> {
	// A handful at a time: TMDB is quick, but a hundred requests at once is rude.
	const found: (Found | null)[] = [];
	for (let i = 0; i < items.length; i += 8) {
		found.push(...(await Promise.all(items.slice(i, i + 8).map(lookUp))));
	}
	const base: Base[] = [];
	items.forEach((item, i) => {
		const f = found[i];
		if (!f) return;
		base.push({
			key: `${item.type}:${f.id}:${item.season ?? 1}`,
			title: f.title,
			season: item.season ?? null,
			type: item.type,
			kind: kindOf(item),
			extra: Boolean(item.extra),
			sourceId: `${item.type}:${f.id}`,
			date: f.date,
			year: f.date ? Number(f.date.slice(0, 4)) : item.year,
			posterUrl: f.poster,
			backdropUrl: f.backdrop,
			overview: f.overview
		});
	});
	return finish(base);
}

/* ------------------------------------------------ TMDB collections */

type Collection = { name: string; posterUrl: string | null; votes: number; items: Base[] };
function getCollection(id: number): Promise<Collection | null> {
	return remembered(`collection|${id}`, () => askCollection(id), () => WEEK);
}

async function askCollection(id: number): Promise<Collection | null | undefined> {
	type Part = {
		id: number;
		title: string;
		release_date?: string;
		poster_path?: string | null;
		backdrop_path?: string | null;
		overview?: string;
		vote_count?: number;
	};
	const data = await tmdbGet<{ name: string; poster_path: string | null; parts: Part[] }>(`/collection/${id}`);
	if (!data) return undefined; // couldn't ask — try again next time
	const value: Collection = {
		name: data.name.replace(/ Collection$/, ''),
		posterUrl: data.poster_path ? POSTER + data.poster_path : null,
		// Total votes across the films: how popular the series is, for ordering search results.
		votes: data.parts.reduce((sum, p) => sum + (p.vote_count ?? 0), 0),
		items: data.parts.map((p) => ({
			key: `movie:${p.id}:1`,
			title: p.title,
			season: null,
			type: 'movie' as const,
			kind: 'film' as const,
			extra: false,
			sourceId: `movie:${p.id}`,
			date: p.release_date || null,
			year: p.release_date ? Number(p.release_date.slice(0, 4)) : null,
			posterUrl: p.poster_path ? POSTER + p.poster_path : null,
			backdropUrl: p.backdrop_path ? BACKDROP + p.backdrop_path : null,
			overview: p.overview ?? ''
		}))
	};
	return value;
}

/** "mcu" for a hand-made list, "collection-10" for a TMDB collection. */
export async function resolveOrder(id: string): Promise<{ name: string; items: ResolvedItem[] } | null> {
	const collection = id.match(/^collection-(\d+)$/);
	if (collection) {
		const found = await getCollection(Number(collection[1]));
		return found ? { name: found.name, items: finish(found.items) } : null;
	}
	const list = orderBySlug(id);
	return list ? { name: list.name, items: await resolveList(list.items) } : null;
}

/* ------------------------------------------------ finding franchises */

async function inBatches<T, R>(things: T[], size: number, fn: (thing: T) => Promise<R>): Promise<R[]> {
	const out: R[] = [];
	for (let i = 0; i < things.length; i += size) out.push(...(await Promise.all(things.slice(i, i + size).map(fn))));
	return out;
}

async function listHits(lists: typeof WATCH_ORDERS): Promise<FranchiseHit[]> {
	return Promise.all(
		lists.map(async (o) => ({
			id: o.slug,
			name: o.name,
			kind: 'list' as const,
			posterUrl: (await lookUp(o.cover))?.poster ?? null,
			count: o.items.filter((i) => !i.extra).length
		}))
	);
}

/** Collections, most popular first. Ones with a single film, or hardly anyone's seen, are left out. */
async function collectionHits(ids: number[]): Promise<FranchiseHit[]> {
	const found = await inBatches(ids, 10, async (id) => ({ id, c: await getCollection(id) }));
	const curatedNames = new Set(WATCH_ORDERS.map((o) => normalizeTitle(o.name)));
	return found
		.filter(({ c }) => c && c.items.length > 1 && c.votes >= 30 && !curatedNames.has(normalizeTitle(c.name)))
		.sort((a, b) => b.c!.votes - a.c!.votes)
		.map(({ id, c }) => ({ id: `collection-${id}`, name: c!.name, kind: 'collection', posterUrl: c!.posterUrl, count: c!.items.length }));
}

const searches = new Map<string, { value: FranchiseHit[]; at: number }>();

/**
 * Hand-made lists whose name matches, then TMDB's film collections by popularity.
 * With nothing typed: every hand-made list and the best-known film series.
 */
export async function searchFranchises(query: string): Promise<FranchiseHit[]> {
	const q = normalizeTitle(query);
	const cached = searches.get(q);
	if (cached && Date.now() - cached.at < WEEK) return cached.value;

	let value: FranchiseHit[];
	if (!q) {
		value = [...(await listHits(WATCH_ORDERS)), ...(await collectionHits(POPULAR_COLLECTIONS))];
	} else {
		const lists = WATCH_ORDERS.filter((o) =>
			[o.name, ...o.aliases].some((n) => normalizeTitle(n).includes(q) || q.includes(normalizeTitle(n)))
		);
		const found = await tmdbGet<{ results: { id: number }[] }>('/search/collection', { query });
		if (!found) return listHits(lists); // TMDB unreachable — don't remember the empty answer
		value = [...(await listHits(lists)), ...(await collectionHits(found.results.slice(0, 20).map((r) => r.id)))].slice(0, 15);
	}
	// Nothing back from TMDB at all means it couldn't be reached: ask again next time.
	if (value.some((hit) => hit.kind === 'collection')) searches.set(q, { value, at: Date.now() });
	return value;
}

/** Fetches the suggestions ahead of time, so the add panel opens with them ready. */
export function warmFranchiseSuggestions(): void {
	searchFranchises('').catch(() => {});
}

/** Looks up everything in your watch orders, and the suggestions, shortly after start-up. */
export async function warmWatchOrders(): Promise<void> {
	for (const { id } of myWatchOrders()) await resolveOrder(id);
	await searchFranchises('');
}

/** Counts towards "x of y watched": out, not an extra, not skipped. */
export const counts = (item: ResolvedItem) => item.released && !item.extra && !item.skipped;
