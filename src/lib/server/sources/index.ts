/**
 * Sources other than Showbox, slotted into a show's one episode list (TMDB's numbering).
 *
 * Anime sites list each season as its own show ("Kaiju No. 8", "Kaiju No. 8 Season 2"), and
 * sometimes split one TMDB season in two. Each of their entries is placed by when it started
 * airing: it belongs to the TMDB season that started around then, and entries landing in the
 * same season follow on from each other (episode 13 of a 24-episode season is episode 1 of its
 * second half). Entries whose names add something else ("Kaiju No. 8: Narumi's Week at Work")
 * only fill a season that is still short of episodes.
 *
 * Only anime is looked up (TMDB: Japanese, animation).
 */
import { normalizeTitle, withoutQualifier } from '../metadata/types';
import { fetchRomajiTitle } from '../metadata/anilist';
import { tmdbGet } from '../metadata/tmdb';
import { anilistResting } from '../metadata/anilistNodes';
import { getOrderCache, saveOrderCache } from '../db/queries';
import type { TmdbShow } from '../combinedEpisodes';
import type { FileOption } from '../showbox';
import {
	searchAniwave,
	aniwaveEpisodes,
	aniwaveShareKey,
	aniwaveHasSoftSub,
	type AniwaveEntry,
	type AniwaveEpisode
} from './aniwave';
import { searchNexus, nexusEpisodes, nexusSubtitles, type NexusShow, type NexusSubtitle } from './animenexus';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/* ------------------------------------------------ placing seasons */

interface Candidate {
	key: string;
	names: string[];
	type: string;
	start: string | null;
	count: () => Promise<number>;
}

interface Placed {
	key: string;
	season: number;
	/** Episodes of the season before this entry's first one. */
	offset: number;
}

const words = (title: string) => normalizeTitle(withoutQualifier(title)).split(' ').filter(Boolean);

/** Words that say which season, not which show. */
const SEASON_WORDS = new Set(['season', 'part', 'cour', 'the', 'final', 'tv', 'arc']);
const isSeasonWord = (w: string) => SEASON_WORDS.has(w) || /^\d+(st|nd|rd|th)?$/.test(w) || /^(i|ii|iii|iv|v)$/.test(w);

const startsWith = (name: string[], prefix: string[]) => prefix.length > 0 && prefix.every((w, i) => name[i] === w);

async function place(show: TmdbShow, titles: string[], candidates: Candidate[]): Promise<Placed[]> {
	const showWords = new Set(titles.flatMap(words));
	const titleWords = titles.map(words);
	const seasons = show.seasons.filter((s) => s.number > 0 && s.airDate).sort((a, b) => a.number - b.number);
	const placed: Placed[] = [];
	const used = new Set<string>();

	for (let i = 0; i < seasons.length; i++) {
		const season = seasons[i];
		// Streaming releases can come weeks before TMDB's date (Stone Ocean on Netflix).
		const from = Date.parse(season.airDate!) - 60 * DAY;
		const to = seasons[i + 1] ? Date.parse(seasons[i + 1].airDate!) - DAY : Infinity;
		const named = normalizeTitle(season.name);
		const seasonWords = new Set(/^(season \d+|specials)$/.test(named) ? [] : words(season.name));

		const here = candidates.filter((c) => {
			if (used.has(c.key) || !c.start || !/^(tv|ona)$/i.test(c.type.trim())) return false;
			const at = Date.parse(c.start);
			return at >= from && at < to;
		});
		// Nothing but the show's name, the season's name, and season words.
		const plain = (c: Candidate) =>
			c.names.some((n) => words(n).every((w) => showWords.has(w) || seasonWords.has(w) || isSeasonWord(w)));
		const related = (c: Candidate) => c.names.some((n) => titleWords.some((t) => startsWith(words(n), t)));

		const chosen: { c: Candidate; n: number }[] = [];
		let total = 0;
		for (const group of [here.filter(plain), here.filter((c) => !plain(c) && related(c))]) {
			if (chosen.length && total >= season.count) break;
			for (const c of group) {
				const n = await c.count();
				if (!n || (total > 0 && total + n > season.count + 1)) continue;
				chosen.push({ c, n });
				total += n;
			}
		}
		chosen.sort((a, b) => Date.parse(a.c.start!) - Date.parse(b.c.start!));
		let offset = 0;
		for (const { c, n } of chosen) {
			used.add(c.key);
			placed.push({ key: c.key, season: season.number, offset });
			offset += n;
		}
	}
	return placed;
}

/**
 * What to search a site for: the show's names (the Japanese one exactly as AniList writes it,
 * "(TV)" and all, which is how a remake is told from the original), the name with the year it
 * started, and each later season by name. A site's quick search only shows its top five.
 */
function searchTerms(show: TmdbShow, title: string, names: string[]): string[] {
	const firstYear = show.seasons.find((s) => s.number === 1)?.airDate?.slice(0, 4);
	const terms = [withoutQualifier(title), show.name, ...names, ...(firstYear ? [`${show.name} (${firstYear})`] : [])];
	for (const s of show.seasons.filter((s) => s.number > 1).slice(0, 8)) {
		const named = normalizeTitle(s.name);
		terms.push(/^season \d+$/.test(named) ? `${show.name} season ${s.number}` : `${show.name} ${s.name}`);
	}
	// OVAs and specials rarely make a show's top five on their own.
	terms.push(`${show.name} OVA`, ...names.filter((n) => n !== show.name).map((n) => `${withoutQualifier(n)} OVA`));
	return [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
}

async function namesFor(show: TmdbShow, title: string): Promise<string[]> {
	const romaji = await fetchRomajiTitle(title).catch(() => null);
	return [...new Set([title, show.name, ...(romaji ? [romaji] : [])])];
}

function saved<T>(key: string, maxAge: number): T | undefined {
	const hit = getOrderCache(key);
	return hit && Date.now() - hit.at < maxAge ? (hit.value as T) : undefined;
}

/* ------------------------------------------------ Aniwave */

/** `label`: an OVA, special or film's own name, for the Specials tab. `film`: it's a film. */
type AniwavePlaced = Placed & { id: number; label?: string; film?: boolean };

/**
 * The show's films, from TMDB: animated films whose names start with the show's ("Re:ZERO
 * -Starting Life in Another World- Memory Snow"), with when they came out. Kept a week.
 */
async function tmdbFilms(show: TmdbShow): Promise<{ title: string; date: string }[]> {
	const key = `tmdb-films|${show.id}`;
	const known = saved<{ title: string; date: string }[]>(key, 7 * DAY);
	if (known) return known;
	type Found = { results: { title: string; release_date?: string; genre_ids?: number[] }[] };
	const found = await tmdbGet<Found>('/search/movie', { query: show.name });
	if (!found) return [];
	const showWords = words(show.name);
	const films = found.results
		// TMDB's "Animation" genre is 16.
		.filter((r) => r.release_date && (r.genre_ids ?? []).includes(16))
		.filter((r) => words(r.title).length > showWords.length && startsWith(words(r.title), showWords))
		.map((r) => ({ title: r.title, date: r.release_date! }));
	saveOrderCache(key, films, Date.now());
	return films;
}

async function placeAniwave(show: TmdbShow, title: string): Promise<AniwavePlaced[]> {
	const key = `aniwave-placed3|${show.id}`;
	const known = saved<AniwavePlaced[]>(key, 6 * HOUR);
	if (known) return known;

	const found = new Map<number, AniwaveEntry>();
	const names = await namesFor(show, title);
	// All the searches at once, then every series' episode count at once. The show's films are
	// searched by their own names: a search for the show only shows its seasons.
	const films = await tmdbFilms(show).catch(() => []);
	const terms = [...searchTerms(show, title, names), ...films.map((f) => f.title)];
	for (const results of await Promise.all(terms.map(searchAniwave))) {
		for (const entry of results) found.set(entry.id, entry);
	}
	const series = [...found.values()].filter((e) => /^(tv|ona)$/i.test(e.type.trim()));
	const counts = new Map(
		await Promise.all(series.map(async (e) => [e.id, (await aniwaveEpisodes(e.id)).length] as const))
	);
	const candidates: Candidate[] = series.map((e) => ({
		key: String(e.id),
		names: [e.name, e.jp].filter(Boolean),
		type: e.type,
		start: e.start,
		count: async () => counts.get(e.id) ?? 0
	}));
	const placed: AniwavePlaced[] = (await place(show, names, candidates)).map((p) => ({ ...p, id: Number(p.key) }));

	// OVAs, specials and films: the Specials tab, in the order they came out, under their own names.
	const titleWords = names.map(words);
	const extras = [...found.values()]
		.filter((e) => /^(ova|special|tv special|movie)$/i.test(e.type.trim()) && e.start)
		.filter((e) => [e.name, e.jp].some((n) => n && titleWords.some((t) => startsWith(words(n), t))))
		.sort((a, b) => Date.parse(a.start!) - Date.parse(b.start!));
	const extraCounts = await Promise.all(extras.map(async (e) => (await aniwaveEpisodes(e.id)).length));
	let next = 0;
	extras.forEach((e, i) => {
		if (!extraCounts[i]) return;
		const film = /^movie$/i.test(e.type.trim());
		placed.push({ key: String(e.id), season: 0, offset: next, id: e.id, label: e.name, ...(film ? { film } : {}) });
		next += extraCounts[i];
	});

	// Matched without AniList's Japanese name (it was resting): good enough for now, redone next time.
	if (!anilistResting()) saveOrderCache(key, placed, Date.now());
	return placed;
}

/**
 * What an OVA's name adds to the show's: "Attack on Titan: No Regrets" → "No Regrets",
 * "Attack on Titan OAD" → "OAD", "Haikyuu!! (OVA)" → "OVA".
 */
function ownPart(label: string, names: string[]): string {
	const tokens = label.split(/\s+/);
	for (const name of names) {
		const count = name.split(/\s+/).length;
		if (count < tokens.length && normalizeTitle(tokens.slice(0, count).join(' ')) === normalizeTitle(name)) {
			return tokens.slice(count).join(' ').replace(/^[\s:\-–]+/, '').replace(/^\((.*)\)$/, '$1').trim();
		}
	}
	return label;
}

/**
 * A special's name in the Specials tab: its episode's title, with what the OVA's name adds when
 * the title doesn't already say it ("OAD: Distress", "No Regrets: Part 1"), or the OVA's name and
 * episode number when there's no title ("OVA · Episode 2").
 */
function specialName(label: string, names: string[], episodeTitle: string, number: number, count: number): string {
	const own = ownPart(label, names) || label;
	if (!episodeTitle) return count > 1 ? `${own} · Episode ${number}` : own;
	const lastPart = own.split(/\s+-\s+|:\s*/).pop()!.toLowerCase();
	return episodeTitle.toLowerCase().includes(lastPart) ? episodeTitle : `${own}: ${episodeTitle}`;
}

/**
 * One episode's files on Aniwave: Japanese audio (without subtitles in the picture when the series
 * has that, `clean`; otherwise with them) and the English dub, whichever it has.
 */
function copiesOf(id: number, e: AniwaveEpisode, name: string, clean: boolean): FileOption[] {
	const list: FileOption[] = [];
	if (e.sub) {
		list.push({
			fid: -1,
			quality: '1080p',
			name: `${name} · Japanese audio${clean ? '' : ', subtitles in the picture'}`,
			size: '',
			source: 'Aniwave',
			audio: 'Japanese',
			...(clean ? {} : { burnedIn: true }),
			shareKey: aniwaveShareKey(id, e.number, clean ? 'ssub' : 'sub')
		});
	}
	if (e.dub) {
		list.push({
			fid: -2,
			quality: '720p',
			name: `${name} · English dub`,
			size: '',
			source: 'Aniwave',
			audio: 'English',
			shareKey: aniwaveShareKey(id, e.number, 'dub')
		});
	}
	return list;
}

/**
 * A film (or one-off OVA or special) on Aniwave, by its exact name in English or Japanese and the
 * year it came out: its files, for one Showbox doesn't have (Re:Zero's Memory Snow). Null when
 * Aniwave has nothing that's certainly it.
 */
export async function aniwaveFilm(title: string, year: string): Promise<FileOption[] | null> {
	// Only anime is on Aniwave: a film AniList doesn't know isn't looked for.
	const romaji = await fetchRomajiTitle(title).catch(() => null);
	if (!romaji) return null;
	const asked = [title, ...(romaji !== title ? [romaji] : [])];
	const wanted = new Set(asked.map((t) => words(t).join(' ')));
	const results = (await Promise.all(asked.map(searchAniwave))).flat();
	const entry = results.find(
		(e) =>
			/^(movie|ova|special|tv special|ona)$/i.test(e.type.trim()) &&
			[e.name, e.jp].some((n) => n && wanted.has(words(n).join(' '))) &&
			(!year || !e.start || Math.abs(Number(e.start.slice(0, 4)) - Number(year)) <= 1)
	);
	if (!entry) return null;
	const first = (await aniwaveEpisodes(entry.id))[0];
	if (!first) return null;
	const files = copiesOf(entry.id, first, entry.name, await aniwaveHasSoftSub(entry.id));
	return files.length ? files : null;
}

/** An episode's copies on Aniwave, and its name there (an OVA's own name, for the Specials tab). */
export type AniwaveCopies = { files: FileOption[]; name?: string };

/**
 * Aniwave's copies of a show's episodes, by "season-episode": a Japanese-audio file (S-Sub,
 * no subtitles in the picture) and an English dub, whichever the episode has. OVAs and
 * specials are season 0, numbered in the order they came out.
 */
export async function aniwaveFiles(show: TmdbShow, title: string): Promise<Map<string, AniwaveCopies>> {
	const files = new Map<string, AniwaveCopies>();
	if (!show.anime) return files;
	try {
		const names = await namesFor(show, title);
		const placed = await placeAniwave(show, title);
		// Series with no Japanese copy free of burned-in subtitles offer the burned-in one instead.
		const softSub = new Map(await Promise.all(placed.map(async (p) => [p.id, await aniwaveHasSoftSub(p.id)] as const)));
		for (const p of placed) {
			const episodes = await aniwaveEpisodes(p.id);
			for (const e of episodes) {
				const episode = p.offset + e.number;
				// A film is named as one ("Memory Snow · Movie").
				const name = p.film
					? `${ownPart(p.label!, names) || p.label} · Movie`
					: p.label
						? specialName(p.label, names, e.title, e.number, episodes.length)
						: e.title || undefined;
				const list = copiesOf(p.id, e, `${show.name} S${p.season}E${episode}`, softSub.get(p.id) ?? true);
				if (list.length) files.set(`${p.season}-${episode}`, { files: list, name });
			}
		}
	} catch (error) {
		console.warn('[aniwave] could not list:', error);
	}
	return files;
}

/* ------------------------------------------------ counting from the first episode */

/** How many episodes come before a TMDB season, counting every season from the first. */
export function episodesBefore(show: TmdbShow, season: number): number {
	return show.seasons.filter((s) => s.number > 0 && s.number < season).reduce((n, s) => n + s.count, 0);
}

/** Where each of Aniwave's series for the show begins, counting from the show's first episode (1 = the first). */
export async function aniwaveSeriesStarts(show: TmdbShow, title: string): Promise<number[]> {
	return (await placeAniwave(show, title))
		.filter((p) => p.season > 0)
		.map((p) => episodesBefore(show, p.season) + p.offset + 1);
}

/** An OVA, special or film's own name on Aniwave (a Specials episode), by its Aniwave series. */
export async function aniwaveExtra(show: TmdbShow, title: string, aniwaveId: number): Promise<{ name: string; film: boolean } | null> {
	const p = (await placeAniwave(show, title)).find((p) => p.id === aniwaveId && p.season === 0);
	return p?.label ? { name: p.label, film: Boolean(p.film) } : null;
}

/** The TMDB season and episode of an Aniwave episode (its series and its own number there). */
export async function tmdbEpisodeOfAniwave(
	show: TmdbShow,
	title: string,
	aniwaveId: number,
	number: number
): Promise<{ season: number; episode: number } | null> {
	const p = (await placeAniwave(show, title)).find((p) => p.id === aniwaveId);
	return p ? { season: p.season, episode: p.offset + number } : null;
}

/* ------------------------------------------------ anime.nexus subtitles */

type NexusPlaced = Placed & { id: string };

async function placeNexus(show: TmdbShow, title: string): Promise<NexusPlaced[]> {
	const key = `nexus-placed|${show.id}`;
	const known = saved<NexusPlaced[]>(key, 12 * HOUR);
	if (known) return known;

	const found = new Map<string, NexusShow>();
	const names = await namesFor(show, title);
	for (const results of await Promise.all(searchTerms(show, title, names).map(searchNexus))) {
		for (const s of results) found.set(s.id, s);
	}
	const candidates: Candidate[] = [...found.values()].map((s) => ({
		key: s.id,
		names: [s.name, s.alt].filter(Boolean),
		type: s.type,
		start: s.start,
		count: async () => s.count || (await nexusEpisodes(s.id)).length
	}));
	const placed = (await place(show, names, candidates)).map((p) => ({ ...p, id: p.key }));
	if (!anilistResting()) saveOrderCache(key, placed, Date.now());
	return placed;
}

/**
 * anime.nexus's subtitle files for one episode (TMDB numbering), or none. "check" when it
 * wants its human check first; `visible` shows its page so the owner can pass it.
 */
export async function nexusSubtitlesFor(
	show: TmdbShow,
	title: string,
	season: number,
	episode: number,
	visible = false
): Promise<NexusSubtitle[] | 'check'> {
	if (!show.anime) return [];
	try {
		const here = (await placeNexus(show, title))
			.filter((p) => p.season === season && p.offset < episode)
			.sort((a, b) => b.offset - a.offset)[0];
		if (!here) return [];
		const match = (await nexusEpisodes(here.id)).find((e) => e.number === episode - here.offset);
		return match ? await nexusSubtitles(match, visible) : [];
	} catch (error) {
		console.warn('[anime.nexus] could not find subtitles:', error);
		return [];
	}
}
