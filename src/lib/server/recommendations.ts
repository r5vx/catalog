/**
 * "More like this": titles like the one open, the way a streaming app suggests them.
 *
 * Anime comes from AniList's recommendations, voted for by its users — even niche ones are good
 * (Haibane Renmei: Serial Experiments Lain, Girls' Last Tour, Kino's Journey).
 *
 * Films and shows: candidates from several places — MovieLens (what the people who loved a film
 * also loved: data/film-neighbours.bin), TMDB's own suggestions, the same series, the
 * director's (or creator's) other work, the same studio (when it's a specific one: Marvel
 * Studios, Pixar), and other titles sharing its topics — then each is scored on everything at once:
 *   - taste: loved by the same people (MovieLens, films up to mid-2023; a newer sequel borrows
 *     its series' earlier films');
 *   - topic: the topics they share ("superhero", "mutant", "time travel"), rarer ones counting more;
 *   - genre: alike; never a cartoon for live action or a documentary for a drama, and another
 *     language counts against it;
 *   - franchise: the same series, director, studio or leading cast (at most three by the
 *     director, so Wicked isn't all Jon M. Chu).
 * Shows have no taste file — no free one exists — so TMDB's suggestions count for more there,
 * and they are weaker than films'.
 * One signal alone isn't enough. Taste alone gave X-Men: Days of Future Past two Star Trek films
 * (people who loved it loved other 2014 blockbusters); topics alone gave The Marvels Alien
 * ("outer space"). Weak matches are left out rather than filling the row.
 *
 * Titles already watched stay in (marked): with most of the library finished, leaving them out
 * left only the poor matches. Kept a few days per title.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmdbGet } from './metadata/tmdb';
import { anilistResting, anilistSaidWait } from './metadata/anilistNodes';
import { entryIdForSource, findEntryByTitle, getEntry, getOrderCache, saveOrderCache, savedAnimeRoots } from './db/queries';
import { sameShowByName } from './metadata/franchise';
import { currentProfile, MAIN_PROFILE } from './profile';

export type Suggestion = {
	source: 'tmdb' | 'anilist';
	sourceId: string;
	title: string;
	year: number | null;
	posterUrl: string | null;
	kind: string;
	/** Only when it says something: "Same series". */
	why?: string;
	/** Finished in the library. */
	watched?: boolean;
	/** Being watched (in the library as Watching). */
	watching?: boolean;
	/** Its library entry, for the right-click menu's "View entry". */
	entryId?: number;
	/** A looser match, shown only after "Show more". */
	more?: boolean;
};

const DAY = 24 * 60 * 60 * 1000;
const SHOWN = 15;
/** How many looser ones "Show more" can add. */
const EXTRA = 45;
const poster = (path?: string | null) => (path ? `https://image.tmdb.org/t/p/w342${path}` : null);
const yearOf = (date?: string | null) => Number(date?.slice(0, 4)) || null;

/** Runs `work` over `items`, a few at a time. */
async function inTurn<T, R>(items: T[], work: (item: T) => Promise<R>, atOnce = 8): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(atOnce, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await work(items[i]);
			}
		})
	);
	return out;
}

/* ------------------------------------------------ the film list from MovieLens */

let neighbours: Buffer | null | undefined;

function neighboursFile(): Buffer | null {
	if (neighbours !== undefined) return neighbours;
	const dir = process.env.CATALOG_DATA ?? join(process.cwd(), 'data');
	const file = join(dir, 'film-neighbours.bin');
	neighbours = existsSync(file) ? readFileSync(file) : null;
	if (neighbours && neighbours.toString('latin1', 0, 4) !== 'CFN1') neighbours = null;
	return neighbours;
}

/** The films most like one by taste (TMDB ids, with a score 0–1); empty if it isn't listed. */
function filmNeighbours(tmdbId: number): Map<number, number> {
	const found = new Map<number, number>();
	const b = neighboursFile();
	if (!b) return found;
	let lo = 0;
	let hi = b.readUInt32LE(4) - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const id = b.readUInt32LE(8 + mid * 8);
		if (id === tmdbId) {
			const at = b.readUInt32LE(12 + mid * 8);
			for (let i = 0; i < b.readUInt8(at); i++) found.set(b.readUInt32LE(at + 1 + i * 5), b.readUInt8(at + 5 + i * 5) / 255);
			return found;
		}
		if (id < tmdbId) lo = mid + 1;
		else hi = mid - 1;
	}
	return found;
}

/* ------------------------------------------------ TMDB */

type Brief = { id: number; title?: string; name?: string; vote_count?: number; adult?: boolean };

/** What's needed to compare a title with another, kept a month. */
type Profile = {
	id: number;
	title: string;
	year: number | null;
	poster: string | null;
	genres: number[];
	topics: number[];
	companies: number[];
	cast: number[];
	makers: number[];
	collection: number | null;
	votes: number;
	rating: number;
	language: string;
	adult: boolean;
	released: boolean;
};

type Full = {
	id: number;
	title?: string;
	name?: string;
	release_date?: string;
	first_air_date?: string;
	poster_path?: string | null;
	genres?: { id: number }[];
	production_companies?: { id: number }[];
	belongs_to_collection?: { id: number } | null;
	created_by?: { id: number }[];
	vote_count?: number;
	vote_average?: number;
	original_language?: string;
	adult?: boolean;
	status?: string;
	keywords?: { keywords?: { id: number; name: string }[]; results?: { id: number; name: string }[] };
	credits?: { cast?: { id: number; order?: number }[]; crew?: { id: number; job: string }[] };
	recommendations?: { results: Brief[] };
};

/** Tags that say nothing about what a title is like. */
const EMPTY_TAG =
	/^(\d{4}s|based on (novel( or book)?|book|true story|short story|real events|memoir)|faithful adaptation|remake|sequel|prequel|duringcreditsstinger|aftercreditsstinger|woman director|independent film|anime|live action|black and white|new york city|los angeles|london, england|paris, france|tokyo, japan|.*\bnovel\b.*|.*\bactor\b.*|.*\bactress\b.*|shared universe)$/i;
/** TMDB's mood words: they match every title in that mood, whatever it's about. */
const MOOD_TAG =
	/^(sinister|serene|ironic|ominous|understated|matter of fact|joyous|sarcastic|mischievous|sincere|somber|melancholy|excited|dignified|assertive|enchant|admiring|amused|antagonistic|anxious|approving|audacious|awestruck|bewildered|cautionary|celebratory|cheerful|comforting|compassionate|complicated|critical|curious|defiant|depressing|desperate|disheartening|dramatic|empathetic|enthusiastic|exhilarated|familiar|frantic|grim|hilarious|hopeful|horrified|humorous|inspirational|intense|introspective|joyful|lighthearted|loving|mean spirited|melodramatic|nostalgic|playful|provocative|reflective|romantic|sad|scary|sentimental|suspenseful|tense|thoughtful|tragic|whimsical|witty|wistful|bold|calm|clever|dark|gentle|harsh|hopeless|innocent|kind|quiet|sweet|uplifting|vibrant|absurd|action|adventure|appreciative)$/i;

async function fullTitle(type: 'movie' | 'tv', id: number): Promise<Full | null> {
	return tmdbGet<Full>(`/${type}/${id}`, { append_to_response: 'keywords,credits,recommendations' });
}

function profileOf(type: 'movie' | 'tv', t: Full): Profile {
	const tags = (t.keywords?.keywords ?? t.keywords?.results ?? []).filter((k) => !EMPTY_TAG.test(k.name) && !MOOD_TAG.test(k.name));
	const date = t.release_date ?? t.first_air_date;
	return {
		id: t.id,
		title: t.title ?? t.name ?? '',
		year: yearOf(date),
		poster: poster(t.poster_path),
		genres: (t.genres ?? []).map((g) => g.id),
		topics: tags.map((k) => k.id),
		companies: (t.production_companies ?? []).map((c) => c.id),
		cast: (t.credits?.cast ?? []).filter((c) => (c.order ?? 99) < 6).map((c) => c.id),
		makers:
			type === 'movie'
				? (t.credits?.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.id)
				: (t.created_by ?? []).map((c) => c.id),
		collection: t.belongs_to_collection?.id ?? null,
		votes: t.vote_count ?? 0,
		rating: t.vote_average ?? 0,
		language: t.original_language ?? '',
		adult: Boolean(t.adult),
		released: Boolean(date && date <= new Date().toISOString().slice(0, 10))
	};
}

async function profile(type: 'movie' | 'tv', id: number): Promise<Profile | null> {
	const key = `tmdb-profile|${type}|${id}`;
	const kept = getOrderCache(key);
	if (kept && Date.now() - kept.at < 30 * DAY) return kept.value as Profile;
	const full = await fullTitle(type, id);
	if (!full) return null;
	const made = profileOf(type, full);
	saveOrderCache(key, made, Date.now());
	return made;
}

/** How many titles carry a topic or come from a studio (TMDB's count), kept a month. */
async function howCommon(type: 'movie' | 'tv', what: 'with_keywords' | 'with_companies', id: number): Promise<number> {
	const key = `tmdb-count|${type}|${what}|${id}`;
	const kept = getOrderCache(key);
	if (kept && Date.now() - kept.at < 30 * DAY) return kept.value as number;
	const found = await tmdbGet<{ total_results?: number }>(`/discover/${type}`, { [what]: String(id) });
	const count = found?.total_results ?? 0;
	if (found) saveOrderCache(key, count, Date.now());
	return count;
}

/** How much a shared topic says: rare ones a lot, common ones little, trivia (a handful) little. */
const topicWeight = (count: number) => (count < 5 ? 0.2 : 1 / Math.log(3 + count));

const ANIMATION = 16;
const HORROR = 27;
const FAMILY = 10751;
const DOCUMENTARY = 99;

/** How alike two titles' genres are (0–1), with the mismatches nobody wants beside each other. */
function genreLikeness(a: number[], b: number[]): number {
	const A = new Set(a);
	const B = new Set(b);
	const shared = [...A].filter((g) => B.has(g)).length;
	const union = new Set([...A, ...B]).size || 1;
	let like = shared / union;
	for (const g of [ANIMATION, HORROR, DOCUMENTARY]) if (A.has(g) !== B.has(g)) like *= 0.25;
	if (A.has(FAMILY) !== B.has(FAMILY)) like *= 0.6;
	return like;
}

/** Films and shows like one on TMDB, scored on everything at once (see the top of the file). */
async function forTmdb(type: 'movie' | 'tv', id: number): Promise<Suggestion[]> {
	const full = await fullTitle(type, id);
	if (!full) return [];
	const base = profileOf(type, full);

	// How telling each of its topics and studios is.
	const topicCounts = new Map(await inTurn(base.topics.slice(0, 25), async (t) => [t, await howCommon(type, 'with_keywords', t)] as const));
	const studioCounts = new Map(await inTurn(base.companies.slice(0, 4), async (c) => [c, await howCommon(type, 'with_companies', c)] as const));
	const topicTotal = [...topicCounts.values()].reduce((sum, n) => sum + topicWeight(n), 0) || 1;

	// Candidates, from everywhere — the strongest kinds first, as only so many are looked at.
	const taste = type === 'movie' ? filmNeighbours(id) : new Map<number, number>();
	const suggested = new Set((full.recommendations?.results ?? []).map((r) => r.id));
	const byCount = [...topicCounts].filter(([, n]) => n >= 5).sort((a, b) => a[1] - b[1]);
	// Its rarest topics find close kin; its broadest real ones (musical, witch) find the
	// rest of its kind.
	const rareTopics = [...byCount.slice(0, 4), ...byCount.filter(([, n]) => n >= 30 && n <= 3000).slice(-2)];
	const specificStudios = [...studioCounts].filter(([, n]) => n > 5 && n < 400).map(([c]) => c);
	const [series, work, more, found] = await Promise.all([
		base.collection && type === 'movie' ? tmdbGet<{ parts?: Brief[] }>(`/collection/${base.collection}`) : Promise.resolve(null),
		// The director's (or creator's) other work.
		inTurn(base.makers.slice(0, 2), (m) =>
			type === 'movie'
				? tmdbGet<{ results?: Brief[] }>('/discover/movie', { with_crew: String(m), sort_by: 'vote_count.desc' })
				: tmdbGet<{ crew?: Brief[] }>(`/person/${m}/tv_credits`).then((c) => ({ results: c?.crew ?? [] }))
		),
		// TMDB's next page of suggestions.
		tmdbGet<{ results?: Brief[] }>(`/${type}/${id}/recommendations`, { page: '2' }),
		inTurn([...rareTopics.map(([t]) => ({ with_keywords: String(t) })), ...specificStudios.map((c) => ({ with_companies: String(c) }))], (q) =>
			tmdbGet<{ results?: Brief[] }>(`/discover/${type}`, { ...q, sort_by: 'vote_count.desc' })
		)
	]);
	for (const r of more?.results ?? []) suggested.add(r.id);
	// Too new for MovieLens (after mid-2023): its series' earlier films stand in, a little
	// less sure (Dune: Part Two takes Dune's, The Marvels Captain Marvel's).
	if (type === 'movie' && !taste.size) {
		for (const part of series?.parts ?? []) {
			for (const [n, score] of filmNeighbours(part.id)) taste.set(n, Math.max(taste.get(n) ?? 0, score * 0.85));
		}
	}
	const ordered = [
		...(series?.parts ?? []).map((p) => p.id),
		...work.flatMap((list) => (list?.results ?? []).slice(0, 12).map((r) => r.id)),
		...taste.keys(),
		...suggested,
		...found.flatMap((list) => (list?.results ?? []).slice(0, 15).map((r) => r.id))
	];
	const pool = new Set(ordered.filter((c) => c !== id));

	const profiles = (await inTurn([...pool].slice(0, 160), (c) => profile(type, c))).filter((p): p is Profile => Boolean(p));
	// Obscure titles have obscure neighbours: the floor follows the title's own votes.
	const floor = Math.min(150, Math.max(10, base.votes * 0.05));
	const scored = profiles
		.filter((p) => p.released && !p.adult && p.votes >= floor && p.title)
		.map((p) => {
			const sameSeries = Boolean(base.collection && p.collection === base.collection);
			const topic = Math.min(1, p.topics.filter((t) => topicCounts.has(t)).reduce((sum, t) => sum + topicWeight(topicCounts.get(t)!), 0) / (topicTotal * 0.5));
			const genre = genreLikeness(base.genres, p.genres);
			const cast = Math.min(1, p.cast.filter((c) => base.cast.includes(c)).length / 2);
			// A studio only counts beside something else in common: Marvel Studios' films share
			// "superhero"; Barbie and Harry Potter share only a producer (Heyday Films).
			const studio = p.companies.some((c) => specificStudios.includes(c)) && (topic >= 0.15 || cast > 0) ? 1 : 0;
			const maker = p.makers.some((m) => base.makers.includes(m)) ? 1 : 0;
			const loved = taste.get(p.id) ?? 0;
			// Shows have no taste file, so TMDB's suggestions (which follow what people watch)
			// count for more there.
			const tmdb = suggested.has(p.id) ? (type === 'tv' ? 0.15 : 0.05) : 0;
			let score = 0.3 * loved + 0.3 * topic + 0.12 * genre + 0.1 * studio + 0.08 * cast + 0.15 * maker + tmdb;
			// Something real in common — loved by the same people, the same topic, director, cast,
			// studio or series. TMDB's suggestion and a similar genre alone gave Dune: Part Two
			// Spider-Man 3 and Barbie Scooby-Doo.
			const evidence =
				loved > 0 || topic >= 0.08 || maker || cast > 0 || studio || sameSeries || (type === 'tv' && tmdb > 0 && genre >= 0.5);
			if (!evidence) score *= 0.35;
			// Nothing in common in what it's about or what it is: it doesn't belong, however loved.
			if (topic < 0.08 && genre < 0.34 && !studio && !cast && !maker && !sameSeries) score *= 0.3;
			// The same director's other films belong even in another genre (Barbie, Little Women).
			score *= genre === 0 && !sameSeries && !maker ? 0.4 : 1;
			score *= 0.75 + Math.min(p.rating, 9) / 36;
			// Another language is a different kind of watch (Berserk for Over the Garden Wall,
			// a Korean drama for The Bear), unless the same people love both.
			// A cartoon for a live-action film, or a documentary for a drama, is never what was
			// meant (Hotel Transylvania 2 for The She Beast), whatever they share.
			const otherForm = [ANIMATION, DOCUMENTARY].some((g) => base.genres.includes(g) !== p.genres.includes(g));
			if (otherForm && !sameSeries && !maker && loved < 0.3) score = 0;
			if (p.language && base.language && p.language !== base.language && loved < 0.3 && !maker) score *= 0.6;
			return { p, score: sameSeries ? 10 + score : score, maker: maker && !sameSeries };
		})
		.sort((a, b) => b.score - a.score);
	// Measured against the third best, so one standout (Better Call Saul) doesn't push out
	// everything else.
	const others = scored.filter((s) => s.score < 10);
	const best = (others[2] ?? others[others.length - 1])?.score ?? 0;
	// At most three of the director's other films, so one busy director (Jon M. Chu has
	// Step Up and Justin Bieber) doesn't fill Wicked's row.
	let byMaker = 0;
	const titles = new Set<string>();
	return scored
		// One of each name: Whiplash is both a short and the film made from it.
		.filter((s) => !titles.has(s.p.title.toLowerCase()) && Boolean(titles.add(s.p.title.toLowerCase())))
		// Weak matches are left out of the row; looser ones wait behind "Show more", which is
		// also where any director's fourth film goes.
		.map((s) => ({ ...s, more: (s.maker && ++byMaker > 3) || (s.score < 10 && s.score < Math.max(0.12, best * 0.45)) }))
		// "Show more" goes a good way further down (with a well-watched series, hiding the
		// watched ones left The Marvels one more), but never to ones with nothing in common.
		.filter((s) => !s.more || s.score >= Math.max(0.03, best * 0.1))
		.map(({ p, score, maker, more }) => ({
			source: 'tmdb' as const,
			sourceId: `${type}:${p.id}`,
			title: p.title,
			year: p.year,
			posterUrl: p.poster,
			kind: type === 'movie' ? 'Movie' : 'TV',
			...(score >= 10 ? { why: 'Same series' } : maker ? { why: type === 'movie' ? 'Same director' : 'Same creator' } : {}),
			...(more ? { more: true } : {})
		}))
		// The row first, the looser ones after.
		.sort((a, b) => Number(Boolean(a.more)) - Number(Boolean(b.more)));
}

/* ------------------------------------------------ AniList */

const ANILIST = 'https://graphql.anilist.co';

type AniNode = {
	id: number;
	title: { romaji: string | null; english: string | null };
	startDate?: { year: number | null };
	format?: string | null;
	coverImage?: { large: string | null };
	isAdult?: boolean;
	genres?: string[];
};

async function anilist<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
	if (anilistResting()) return null;
	try {
		const resp = await fetch(ANILIST, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ query, variables }),
			signal: AbortSignal.timeout(10000)
		});
		if (resp.status === 429) {
			anilistSaidWait(resp);
			return null;
		}
		if (!resp.ok) return null;
		return ((await resp.json()) as { data?: T }).data ?? null;
	} catch {
		return null;
	}
}

const RECOMMENDED = `query ($id: Int, $search: String) {
  Media(id: $id, search: $search, type: ANIME) {
    id
    recommendations(sort: RATING_DESC, perPage: 45) {
      nodes { rating mediaRecommendation { id title { romaji english } startDate { year } format coverImage { large } isAdult genres } }
    }
    title { romaji english }
  }
}`;

const FORMAT: Record<string, string> = { MOVIE: 'Movie', OVA: 'OVA', SPECIAL: 'Special', MUSIC: 'Music' };

async function forAnime(by: { id?: number; search?: string }): Promise<Suggestion[] | null> {
	type Answer = {
		Media: { title: AniNode['title']; recommendations: { nodes: { rating: number; mediaRecommendation: AniNode | null }[] } } | null;
	};
	const data = await anilist<Answer>(RECOMMENDED, by);
	if (!data?.Media) return null;
	const namesOf = (m: { title: AniNode['title'] }) => [m.title.english, m.title.romaji].filter((t): t is string => Boolean(t));
	const sameShow = (a: { title: AniNode['title'] }, b: { title: AniNode['title'] }) =>
		namesOf(a).some((x) => namesOf(b).some((y) => sameShowByName(x, y)));
	// One card per show, as in the library: Frieren's second season beside its first was the same
	// show twice. The first one listed (the better-recommended) stays; the title's own other
	// seasons are left out altogether.
	const kept: AniNode[] = [];
	for (const n of data.Media.recommendations.nodes) {
		const m = n.mediaRecommendation;
		if (n.rating <= 0 || !m || m.isAdult) continue;
		// As browsing does: nothing suggestive on the family's TVs.
		if (m.genres?.some((g) => g === 'Ecchi' || g === 'Hentai')) continue;
		if (sameShow(m, data.Media) || kept.some((k) => sameShow(k, m))) continue;
		kept.push(m);
	}
	return kept
		.map((m) => ({
			source: 'anilist' as const,
			sourceId: String(m.id),
			title: m.title.english || m.title.romaji || '',
			year: m.startDate?.year ?? null,
			posterUrl: m.coverImage?.large ?? null,
			kind: FORMAT[m.format ?? ''] ?? 'Anime'
		}));
}

/* ------------------------------------------------ altogether */

/** A show's name without its season ("Frieren … Season 2" → "Frieren …"), to find it in the library by name. */
const showName = (title: string) =>
	title.replace(/[\s:,-]*(?:season\s*\d+|\d+(?:st|nd|rd|th)\s+season|part\s*\d+|cour\s*\d+|\b(?:ii|iii|iv|v))\s*$/i, '').trim();

/**
 * It in the library: by its own id, by the show an anime season belongs to (the library keeps
 * one card per show, under its first season's id), else by name — the only way for a family
 * member's profile, and for an anime the library has under TMDB.
 */
function inLibrary(s: Suggestion): { status: string; entryId?: number } | null {
	if (currentProfile() === MAIN_PROFILE) {
		const ids = [s.sourceId];
		if (s.source === 'anilist') {
			const root = savedAnimeRoots([Number(s.sourceId)]).get(Number(s.sourceId));
			if (root) ids.push(String(root));
		}
		for (const id of ids) {
			const entryId = entryIdForSource(s.source, id);
			const entry = entryId !== null ? getEntry(entryId) : null;
			if (entry && entryId !== null) return { status: entry.status, entryId };
		}
	}
	const named = findEntryByTitle(s.title) ?? (showName(s.title) !== s.title ? findEntryByTitle(showName(s.title)) : null);
	if (!named) return null;
	return currentProfile() === MAIN_PROFILE ? { status: named.status, entryId: named.id } : { status: named.status };
}

function marked(s: Suggestion): Suggestion {
	const mine = inLibrary(s);
	if (!mine) return s;
	return {
		...s,
		...(mine.entryId ? { entryId: mine.entryId } : {}),
		...(mine.status === 'completed' ? { watched: true } : mine.status === 'watching' ? { watching: true } : {})
	};
}

const working = new Map<string, Promise<Suggestion[] | null>>();

async function workOut(source: string, sourceId: string, title: string): Promise<Suggestion[] | null> {
	if (source === 'anilist') return forAnime({ id: Number(sourceId) });
	const [type, rawId] = sourceId.split(':') as ['movie' | 'tv', string];
	const id = Number(rawId);
	const head = await profile(type, id);
	const anime = head && head.language === 'ja' && head.genres.includes(ANIMATION);
	const list = anime ? await forAnime({ search: head.title || title }) : null;
	return list?.length ? list : forTmdb(type, id);
}

/**
 * Starts working out a title's "More like this" without waiting for it — called as its page
 * loads, so by the time the page shows and the row asks, it's under way or done (about half a
 * second to a second sooner than starting when the row asks).
 */
export function startMoreLikeThis(source: string, sourceId: string, title = ''): void {
	if (source !== 'tmdb' && source !== 'anilist') return;
	moreLikeThis(source, sourceId, title).catch(() => {});
}

/**
 * Titles like this one. `source` and `sourceId` as everywhere else ('tmdb' 'movie:157336',
 * 'anilist' '21'); `title` helps an anime listed under TMDB be found on AniList.
 */
export async function moreLikeThis(source: string, sourceId: string, title = ''): Promise<Suggestion[]> {
	const key = `recs4|${source}|${sourceId}`;
	const kept = getOrderCache(key);
	// Kept a month: what's like a title hardly changes, and whether each is watched is looked
	// up fresh every time below. (It was 3 days; the first time takes 4–5 s, after that 0.1 s.)
	let list = kept && Date.now() - kept.at < 30 * DAY ? (kept.value as Suggestion[]) : null;

	if (!list) {
		// One working-out per title at a time: the page starts it as it loads (startMoreLikeThis),
		// and the row's own request a moment later joins it.
		let work = working.get(key);
		if (!work) {
			work = workOut(source, sourceId, title)
				.then((found) => {
					// Only an answer is kept (AniList resting, TMDB not answering: asked again next time).
					if (found?.length) saveOrderCache(key, found, Date.now());
					return found;
				})
				.finally(() => working.delete(key));
			working.set(key, work);
		}
		list = await work;
	}

	const seen = new Set<string>();
	return (list ?? [])
		.filter((s) => {
			const id = `${s.source}|${s.sourceId}`;
			if (seen.has(id) || (s.source === source && s.sourceId === sourceId) || !s.title) return false;
			seen.add(id);
			return true;
		})
		.slice(0, SHOWN + EXTRA)
		.map((s, i) => marked({ ...s, ...(i >= SHOWN ? { more: true } : {}) }));
}
