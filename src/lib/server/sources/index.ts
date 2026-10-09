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
import { anilistResting } from '../metadata/anilistNodes';
import { getOrderCache, saveOrderCache } from '../db/queries';
import type { TmdbShow } from '../combinedEpisodes';
import type { FileOption } from '../showbox';
import { searchAniwave, aniwaveEpisodes, aniwaveShareKey, type AniwaveEntry } from './aniwave';
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

type AniwavePlaced = Placed & { id: number };

async function placeAniwave(show: TmdbShow, title: string): Promise<AniwavePlaced[]> {
	const key = `aniwave-placed|${show.id}`;
	const known = saved<AniwavePlaced[]>(key, 6 * HOUR);
	if (known) return known;

	const found = new Map<number, AniwaveEntry>();
	const names = await namesFor(show, title);
	// All the searches at once, then every series' episode count at once.
	for (const results of await Promise.all(searchTerms(show, title, names).map(searchAniwave))) {
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
	const placed = (await place(show, names, candidates)).map((p) => ({ ...p, id: Number(p.key) }));
	// Matched without AniList's Japanese name (it was resting): good enough for now, redone next time.
	if (!anilistResting()) saveOrderCache(key, placed, Date.now());
	return placed;
}

/**
 * Aniwave's copies of a show's episodes, by "season-episode": a Japanese-audio file (S-Sub,
 * no subtitles in the picture) and an English dub, whichever the episode has.
 */
export async function aniwaveFiles(show: TmdbShow, title: string): Promise<Map<string, FileOption[]>> {
	const files = new Map<string, FileOption[]>();
	if (!show.anime) return files;
	try {
		for (const p of await placeAniwave(show, title)) {
			for (const e of await aniwaveEpisodes(p.id)) {
				const episode = p.offset + e.number;
				const list: FileOption[] = [];
				if (e.sub) {
					list.push({
						fid: -1,
						quality: '1080p',
						name: `${show.name} S${p.season}E${episode} · Japanese audio`,
						size: '',
						source: 'Aniwave',
						audio: 'Japanese',
						shareKey: aniwaveShareKey(p.id, e.number, 'ssub')
					});
				}
				if (e.dub) {
					list.push({
						fid: -2,
						quality: '720p',
						name: `${show.name} S${p.season}E${episode} · English dub`,
						size: '',
						source: 'Aniwave',
						audio: 'English',
						shareKey: aniwaveShareKey(p.id, e.number, 'dub')
					});
				}
				if (list.length) files.set(`${p.season}-${episode}`, list);
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
	return (await placeAniwave(show, title)).map((p) => episodesBefore(show, p.season) + p.offset + 1);
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
