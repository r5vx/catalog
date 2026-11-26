/**
 * Catasong → Guess the Anime: hear 15 s of an anime opening or ending (its start, or any part), name the anime.
 *
 * Where the songs come from: AnimeThemes (animethemes.moe) keeps every opening and ending as a
 * sound file (Ogg Opus on a.animethemes.moe), and its public GraphQL API (90 asks a minute, no
 * key) finds them by AniList id, 50 anime per ask. Which anime: AniList's most popular, 50 to a
 * page, so a level is a range of pages (Easy is the 150 best known, Niche is 1,201st–2,500th).
 * "My anime" is every anime in the library.
 *
 * A level's list is made the first time it's played, a page at a time, and kept 14 days
 * (watch_order_cache, `catasong-anime2|<level>`). Rounds can start once the first page is in;
 * the rest keeps coming in the background.
 *
 * The answer stays here: the page gets a round's token, its sound through
 * /api/catasong/anime/audio/<token> (so the file name doesn't give it away), and the answer
 * only once it's guessed or given up.
 */
import { randomBytes } from 'node:crypto';
import { anilistResting, anilistSaidWait } from '../metadata/anilistNodes';
import { sameShowByName, showRoots } from '../metadata/franchise';
import { getOrderCache, saveOrderCache, libraryAnime } from '../db/queries';
import { readSettings, updateSettings } from '../settings';

export type Level = 'easy' | 'medium' | 'hard' | 'niche' | 'mine';
export type Kinds = 'op' | 'ed' | 'both';

export const LEVELS: { value: Level; label: string }[] = [
	{ value: 'easy', label: 'Easy' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'hard', label: 'Hard' },
	{ value: 'niche', label: 'Niche' },
	{ value: 'mine', label: 'My anime' }
];

/** AniList popularity pages (50 anime each) per level. */
const PAGES: Record<Exclude<Level, 'mine'>, { from: number; to: number }> = {
	easy: { from: 1, to: 3 },
	medium: { from: 4, to: 10 },
	hard: { from: 11, to: 24 },
	niche: { from: 25, to: 50 }
};

export type Show = { id: number; english: string | null; romaji: string; cover: string | null; year: number | null };
type Theme = { audio: string; show: number; type: 'OP' | 'ED'; sequence: number | null; song: string | null; artist: string | null };
type Pool = { shows: Show[]; themes: Theme[]; page: number; done: boolean; ids?: string };

const KEEP = 14 * 24 * 60 * 60 * 1000;
const MINE_KEEP = 24 * 60 * 60 * 1000;
const ANILIST = 'https://graphql.anilist.co';
const THEMES = 'https://rs.animethemes.moe/graphql';
const AUDIO = 'https://a.animethemes.moe/';
/** AnimeThemes asks for a User-Agent. A plain name, nothing that says whose Catalog it is (as music.ts). */
export const UA = 'Catalog/4 (personal media library)';

const cacheKey = (level: Level) => `catasong-anime2|${level}`;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/* ------------------------------------------------------------------ asking AniList and AnimeThemes */

const SHOWS_QUERY = `
query ($page: Int, $ids: [Int]) {
  Page(page: $page, perPage: 50) {
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false, id_in: $ids, format_in: [TV, TV_SHORT, MOVIE, ONA, OVA, SPECIAL]) {
      id
      title { romaji english }
      coverImage { large }
      seasonYear
    }
  }
}`;

type AniListShow = { id: number; title: { romaji: string | null; english: string | null }; coverImage: { large: string | null }; seasonYear: number | null };

/** One page of shows, or null when AniList can't be asked right now. */
async function showsPage(page: number, ids?: number[]): Promise<Show[] | null> {
	if (anilistResting()) return null;
	try {
		const response = await fetch(ANILIST, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ query: SHOWS_QUERY, variables: ids ? { page, ids } : { page } }),
			signal: AbortSignal.timeout(10_000)
		});
		if (response.status === 429) {
			anilistSaidWait(response);
			return null;
		}
		if (!response.ok) return null;
		const payload = (await response.json()) as { data?: { Page?: { media?: AniListShow[] } } };
		return (payload.data?.Page?.media ?? []).map((m) => ({
			id: m.id,
			english: m.title.english,
			romaji: m.title.romaji ?? m.title.english ?? '',
			cover: m.coverImage.large,
			year: m.seasonYear
		}));
	} catch {
		return null;
	}
}

const THEMES_QUERY = (ids: number[]) => `
query {
  filterAnimeByExternalSite(site: ANILIST, id: [${ids.join(',')}]) {
    resources { edges { node { site link } } }
    themes {
      type
      sequence
      song { title { romaji } staff { role artist { name { main } } } }
      entries { videos { nodes { overlap nc audio { basename } } } }
    }
  }
}`;

type ThemesAnswer = {
	resources: { edges: { node: { site: string; link: string | null } }[] };
	themes: {
		type: string;
		sequence: number | null;
		song: { title: { romaji: string | null } | null; staff: { role: string | null; artist: { name: { main: string } } | null }[] } | null;
		entries: { videos: { nodes: { overlap: string | null; nc: boolean | null; audio: { basename: string } | null }[] } }[];
	}[];
};

/** Every opening and ending AnimeThemes has for these AniList ids (50 at most), or null if it didn't answer. */
async function themesFor(ids: number[]): Promise<Theme[] | null> {
	if (ids.length === 0) return [];
	try {
		const response = await fetch(THEMES, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
			body: JSON.stringify({ query: THEMES_QUERY(ids) }),
			signal: AbortSignal.timeout(20_000)
		});
		if (!response.ok) return null;
		const payload = (await response.json()) as { data?: { filterAnimeByExternalSite?: ThemesAnswer[] } };
		const list = payload.data?.filterAnimeByExternalSite;
		if (!list) return null;

		const wanted = new Set(ids);
		const seen = new Set<string>();
		const themes: Theme[] = [];
		for (const anime of list) {
			const show = anime.resources.edges
				.map(({ node }) => (node.site === 'ANILIST' ? Number(node.link?.match(/anime\/(\d+)/)?.[1]) : NaN))
				.find((id) => wanted.has(id));
			if (!show) continue;
			for (const theme of anime.themes) {
				if (theme.type !== 'OP' && theme.type !== 'ED') continue;
				// Only the song by itself: a video whose song plays over the episode (overlap OVER or
				// TRANSITION: Cowboy Bebop's last ending, Domestic Girlfriend's second) is mostly the
				// episode's own sound, talking and footsteps. Creditless copies first. No name, no round.
				if (!theme.song?.title?.romaji) continue;
				const clean = theme.entries
					.flatMap((e) => e.videos.nodes)
					.filter((v) => v.audio?.basename && (v.overlap ?? 'NONE') === 'NONE')
					.sort((a, b) => Number(Boolean(b.nc)) - Number(Boolean(a.nc)));
				const audio = clean[0]?.audio?.basename;
				if (!audio || seen.has(audio)) continue;
				seen.add(audio);
				const singer = theme.song?.staff.find((s) => s.role === 'Performance') ?? theme.song?.staff[0];
				themes.push({
					audio,
					show,
					type: theme.type,
					sequence: theme.sequence,
					song: theme.song?.title?.romaji ?? null,
					artist: singer?.artist?.name.main ?? null
				});
			}
		}
		return themes;
	} catch {
		return null;
	}
}

/* ------------------------------------------------------------------ the library's anime on AniList */

const MATCH_KEY = 'catasong-anime-match2';
/** TMDB key ("tmdb:tv:1429") → its AniList show, or 0 when AniList had nothing by that name. Kept for good. */
let matched: Record<string, Show | 0> | undefined;

/**
 * Matches library anime from TMDB to AniList by name (and year, within one), all in one AniList
 * ask (aliases). The show's name, poster and year come in the same answer, so nothing more is
 * asked of AniList for them. False when AniList can't be asked right now.
 */
async function matchOnAniList(batch: { key: string; title: string; year: number | null }[]): Promise<boolean> {
	if (batch.length === 0) return true;
	if (anilistResting()) return false;
	const query = `query (${batch.map((_, n) => `$s${n}: String`).join(', ')}) { ${batch
		.map(
			(_, n) =>
				`m${n}: Page(perPage: 3) { media(search: $s${n}, type: ANIME, isAdult: false) { id title { romaji english } coverImage { large } seasonYear } }`
		)
		.join(' ')} }`;
	const variables = Object.fromEntries(batch.map((a, n) => [`s${n}`, a.title]));
	try {
		const response = await fetch(ANILIST, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ query, variables }),
			signal: AbortSignal.timeout(10_000)
		});
		if (response.status === 429) {
			anilistSaidWait(response);
			return false;
		}
		if (!response.ok) return false;
		const payload = (await response.json()) as { data?: Record<string, { media: AniListShow[] }> };
		batch.forEach((a, n) => {
			const found = payload.data?.[`m${n}`]?.media ?? [];
			const near = found.find((m) => a.year && m.seasonYear && Math.abs(m.seasonYear - a.year) <= 1) ?? found[0];
			matched![a.key] = near
				? { id: near.id, english: near.title.english, romaji: near.title.romaji ?? near.title.english ?? a.title, cover: near.coverImage.large, year: near.seasonYear }
				: 0;
		});
		saveOrderCache(MATCH_KEY, matched, Date.now());
		return true;
	} catch {
		return false;
	}
}

/**
 * "My anime", ten library anime at a time: match them (AniList, only those not matched before),
 * then ask AnimeThemes for their songs, and keep what's found at once, so the first round can
 * start after the first ten instead of after the whole library (owner, 2026-11-26: it "took
 * forever"). `page` counts the library anime gone through.
 */
async function buildMine(fresh: boolean) {
	matched ??= (getOrderCache(MATCH_KEY)?.value as Record<string, Show | 0> | undefined) ?? {};
	const old = saved('mine');
	const anime = libraryAnime();
	const idsKey = String(anime.length);
	let pool: Pool = !fresh && old && old.pool.ids === idsKey ? old.pool : { shows: [], themes: [], page: 0, done: false, ids: idsKey };
	const at = pool === old?.pool ? old.at : Date.now();
	const known = new Set(pool.shows.map((s) => s.id));

	for (let from = pool.page; from < anime.length; from += 10) {
		const chunk = anime.slice(from, from + 10);
		const asked = chunk.filter((a) => a.key.startsWith('tmdb:') && !(a.key in matched!));
		if (!(await matchOnAniList(asked))) return;
		const fromAniList = chunk.filter((a) => a.key.startsWith('anilist:')).map((a) => Number(a.key.slice(8)));
		const listed = fromAniList.length ? await showsPage(1, fromAniList) : [];
		if (listed === null) return;
		const shows = [...chunk.map((a) => matched![a.key]).filter((s): s is Show => Boolean(s)), ...listed].filter(
			(s, i, all) => !known.has(s.id) && all.findIndex((o) => o.id === s.id) === i
		);
		const themes = await themesFor(shows.map((s) => s.id));
		if (!themes) return;
		const withSongs = new Set(themes.map((t) => t.show));
		for (const show of shows) known.add(show.id);
		pool = {
			...pool,
			shows: [...pool.shows, ...shows.filter((s) => withSongs.has(s.id))],
			themes: [...pool.themes, ...themes],
			page: Math.min(anime.length, from + 10)
		};
		keep('mine', pool, at);
		if (asked.length || listed.length) await sleep(1500);
	}
	keep('mine', { ...pool, done: true }, at);
}

/* ------------------------------------------------------------------ each level's list */

const pools = new Map<Level, { pool: Pool; at: number }>();
const building = new Set<Level>();

function saved(level: Level): { pool: Pool; at: number } | undefined {
	const kept = pools.get(level);
	if (kept) return kept;
	const row = getOrderCache(cacheKey(level));
	if (!row) return undefined;
	const found = { pool: row.value as Pool, at: row.at };
	pools.set(level, found);
	return found;
}

function keep(level: Level, pool: Pool, at: number) {
	pools.set(level, { pool, at });
	saveOrderCache(cacheKey(level), pool, at);
}

/** Adds AniList pages to a level's list until it's whole; stops (to carry on later) when either site doesn't answer. */
async function build(level: Level, fresh: boolean) {
	if (building.has(level)) return;
	building.add(level);
	try {
		if (level === 'mine') return await buildMine(fresh);
		const old = saved(level);
		let pool: Pool = !fresh && old ? old.pool : { shows: [], themes: [], page: 0, done: false };
		const at = pool === old?.pool ? old.at : Date.now();
		const range = PAGES[level];

		for (let page = Math.max(pool.page + 1, range.from); page <= range.to; page++) {
			const shows = await showsPage(page);
			if (!shows) return;
			const themes = await themesFor(shows.map((s) => s.id));
			if (!themes) return;
			const withSongs = new Set(themes.map((t) => t.show));
			pool = {
				...pool,
				shows: [...pool.shows, ...shows.filter((s) => withSongs.has(s.id))],
				themes: [...pool.themes, ...themes],
				page
			};
			// A fresh list only replaces the old one once it has as much as the old one had.
			if (!old || pool.page >= old.pool.page || !fresh) keep(level, pool, at);
			await sleep(2200);
		}
		keep(level, { ...pool, done: true }, at);
	} finally {
		building.delete(level);
	}
}

/** How far a level's list has got, for the page's "getting ready" line. */
export function progressOf(level: Level): { done: number; of: number } | null {
	if (level !== 'mine') return null;
	return { done: saved('mine')?.pool.page ?? 0, of: libraryAnime().length };
}

/** Starts (or carries on) making a level's list before Start is pressed. */
export function warm(level: Level) {
	poolFor(level);
	// And a first round with its song, so Start plays at once.
	prepare(level, 'both');
}

/**
 * A round ready for every level whose list is already made, so changing level plays at once too.
 * Lists not made yet are left alone (making them all would run into AniList's limit).
 */
export function warmMade() {
	for (const { value } of LEVELS) if (saved(value)?.pool.themes.length) prepare(value, 'both');
}

/** Posters for the page's background: the level's shows, else Easy's. */
export function postersFor(level: Level): string[] {
	const shows = saved(level)?.pool.shows.length ? saved(level)!.pool.shows : (saved('easy')?.pool.shows ?? []);
	const covers = shows.map((s) => s.cover).filter((c): c is string => Boolean(c));
	for (let i = covers.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[covers[i], covers[j]] = [covers[j], covers[i]];
	}
	return covers.slice(0, 40);
}

/** A level's list as it is now (maybe still coming in), starting or carrying on its making. */
function poolFor(level: Level): Pool | undefined {
	const kept = saved(level);
	const stale = kept && Date.now() - kept.at > (level === 'mine' ? MINE_KEEP : KEEP);
	// The library's anime list changing shows as a different count (a cheap check; the day-old rule catches swaps).
	const mineChanged = level === 'mine' && kept && kept.pool.ids !== String(libraryAnime().length);
	if (!kept || !kept.pool.done) void build(level, false);
	else if (stale || mineChanged) void build(level, true);
	return kept?.pool;
}

/* ------------------------------------------------------------------ rounds */

type Round = { theme: Theme; show: Show; at: number };
const rounds = new Map<string, Round>();
const recent: Record<string, number[]> = {};
const ROUND_LIFE = 6 * 60 * 60 * 1000;

export type RoundAnswer =
	| { token: string; type: 'OP' | 'ED' }
	| { waiting: true; have: number; progress: { done: number; of: number } | null }
	| { empty: true };

/*
 * Rounds made ahead: AnimeThemes takes about a second to start sending a song and two or three to
 * send it all (owner, 2026-11-26: "takes a while still"). So a round is made, and its song
 * downloaded here, before it's asked for: one per level and song kind, made when the page opens
 * (`warm`) and again each time one is handed out. The page then gets its song from memory.
 */
const ready = new Map<string, string>();
const sounds = new Map<string, Promise<{ bytes: ArrayBuffer; type: string } | null>>();

function fetchSound(token: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
	let sound = sounds.get(token);
	if (!sound) {
		const round = rounds.get(token);
		sound = round
			? fetch(AUDIO + encodeURIComponent(round.theme.audio), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) })
					.then(async (answer) => (answer.ok ? { bytes: await answer.arrayBuffer(), type: answer.headers.get('Content-Type') ?? 'audio/ogg' } : null))
					.catch(() => null)
			: Promise.resolve(null);
		sounds.set(token, sound);
	}
	return sound;
}

function prepare(level: Level, kinds: Kinds) {
	const key = `${level}|${kinds}`;
	if (ready.has(key)) return;
	const made = makeRound(level, kinds);
	if (!('token' in made)) return;
	ready.set(key, made.token);
	void fetchSound(made.token);
}

/** A round: the one made ahead if there is one (its song is already here), and the next is made. */
export function newRound(level: Level, kinds: Kinds): RoundAnswer {
	const key = `${level}|${kinds}`;
	const early = ready.get(key);
	ready.delete(key);
	const round = early ? rounds.get(early) : undefined;
	const answer: RoundAnswer = early && round ? { token: early, type: round.theme.type } : makeRound(level, kinds);
	if ('token' in answer) {
		void fetchSound(answer.token);
		prepare(level, kinds);
	}
	return answer;
}

/** A round's song, from memory when it was downloaded ahead; null for a token that isn't a round. */
export async function soundOf(token: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
	if (!rounds.has(token)) return null;
	const sound = await fetchSound(token);
	// Handed over once: the page keeps it decoded, and memory isn't held for songs already played.
	sounds.delete(token);
	return sound;
}

function makeRound(level: Level, kinds: Kinds): RoundAnswer {
	const pool = poolFor(level);
	const fits = (pool?.themes ?? []).filter((t) => kinds === 'both' || t.type.toLowerCase() === kinds);
	const shows = new Set(fits.map((t) => t.show));
	// "My anime" can start with a few (the rest are still being matched); a level wants a few more.
	if (shows.size < (level === 'mine' ? 4 : 8)) {
		if (!pool?.done || building.has(level)) return { waiting: true, have: shows.size, progress: progressOf(level) };
		if (shows.size === 0) return { empty: true };
	}

	// No show twice within the last half of the level (or 30 rounds), so a season's songs don't bunch up.
	const last = (recent[level] ??= []);
	const fresh = fits.filter((t) => !last.includes(t.show));
	const choices = fresh.length ? fresh : fits;
	const theme = choices[Math.floor(Math.random() * choices.length)];
	const show = pool!.shows.find((s) => s.id === theme.show)!;
	last.push(theme.show);
	while (last.length > Math.min(30, Math.floor(shows.size / 2))) last.shift();

	for (const [token, round] of rounds) {
		if (Date.now() - round.at > ROUND_LIFE) {
			rounds.delete(token);
			sounds.delete(token);
		}
	}
	const token = randomBytes(9).toString('base64url');
	rounds.set(token, { theme, show, at: Date.now() });
	return { token, type: theme.type };
}

/** The sound file's address for a round, or undefined for a token that isn't one. */
export function audioOf(token: string): string | undefined {
	const round = rounds.get(token);
	return round ? AUDIO + encodeURIComponent(round.theme.audio) : undefined;
}

export type Answer = {
	id: number;
	title: string;
	other: string | null;
	cover: string | null;
	year: number | null;
	theme: string;
	song: string | null;
	artist: string | null;
};

function answerOf(round: Round): Answer {
	const { show, theme } = round;
	return {
		id: show.id,
		title: show.english ?? show.romaji,
		other: show.english && show.english !== show.romaji ? show.romaji : null,
		cover: show.cover,
		year: show.year,
		theme: `${theme.type === 'OP' ? 'Opening' : 'Ending'}${theme.sequence ? ` ${theme.sequence}` : ''}`,
		song: theme.song,
		artist: theme.artist
	};
}

const names = (show: Show) => [show.english, show.romaji].filter((n): n is string => Boolean(n));

/**
 * A guess (an AniList id from the names list) or a give-up (null). Another season of the same
 * show counts: "Attack on Titan" for Season 3's opening is right. By name first; when the names
 * don't say (Noragami and Noragami Aragoto), AniList's season links decide.
 */
export async function guess(token: string, id: number | null): Promise<{ right: boolean; answer?: Answer } | undefined> {
	const round = rounds.get(token);
	if (!round) return undefined;
	if (id === null) return { right: false, answer: answerOf(round) };
	const guessed = allShows().get(id);
	let right =
		id === round.show.id ||
		(guessed !== undefined && names(guessed).some((a) => names(round.show).some((b) => sameShowByName(a, b))));
	if (!right && !anilistResting()) {
		const roots = await showRoots([id, round.show.id]).catch(() => null);
		right = Boolean(roots && roots.get(id) === roots.get(round.show.id));
	}
	return right ? { right, answer: answerOf(round) } : { right };
}

function allShows(): Map<number, Show> {
	const all = new Map<number, Show>();
	for (const { value } of LEVELS) for (const show of saved(value)?.pool.shows ?? []) all.set(show.id, show);
	return all;
}

/** Every anime the guess box can offer: all the levels' lists together, so the box doesn't hint at the level. */
export function guessNames(): { id: number; name: string; other: string | null }[] {
	return [...allShows().values()].map((show) => ({
		id: show.id,
		name: show.english ?? show.romaji,
		other: show.english && show.english !== show.romaji ? show.romaji : null
	}));
}

/* ------------------------------------------------------------------ best streaks */

export function bestStreaks(): Partial<Record<Level, number>> {
	try {
		return JSON.parse(readSettings().catasongAnimeBest ?? '{}');
	} catch {
		return {};
	}
}

export function noteStreak(level: Level, streak: number): Partial<Record<Level, number>> {
	const best = bestStreaks();
	if (streak > (best[level] ?? 0)) {
		best[level] = streak;
		updateSettings({ catasongAnimeBest: JSON.stringify(best) });
	}
	return best;
}

export const isLevel = (value: unknown): value is Level => LEVELS.some((l) => l.value === value);
export const isKinds = (value: unknown): value is Kinds => value === 'op' || value === 'ed' || value === 'both';
