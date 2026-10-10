/**
 * One episode list per show, numbered the way TMDB numbers it.
 *
 * Showbox sometimes splits a show in two: JoJo's Bizarre Adventure has seasons 1–6 so far, and
 * a separate "Steel Ball Run: JoJo's Bizarre Adventure" entry that is ahead on season 6 (TMDB
 * names season 6 "STEEL BALL RUN"). This finds those other entries and slots their episodes into
 * the main list, so the show is one list and the newest episodes are in it.
 *
 * An entry only joins when TMDB agrees it's the same show: a season of the show has its name,
 * or TMDB's search for it finds the same show. "Four Knights of the Apocalypse" starts with
 * "The Seven Deadly Sins" but is its own show on TMDB, so it stays out.
 *
 * Episodes TMDB lists that no entry has yet are added greyed out ("not on Showbox" or, if
 * they haven't aired, the date they air), so a season shows as it really is. Specials
 * (season 0) come last, and only when at least one of them can be played.
 *
 * Each episode carries the share it plays from; the main entry's is left off.
 * Later, other sources can fill episodes in the same way.
 */
import { tmdbGet } from './metadata/tmdb';
import { normalizeTitle, withoutQualifier } from './metadata/types';
import {
	searchShowbox,
	getFebboxLink,
	extractShareKey,
	listEpisodes,
	resolveSlugId,
	type EpisodeInfo,
	type ShowboxResult
} from './showbox';
import { getOrderCache, saveOrderCache } from './db/queries';
import { aniwaveFiles, aniwaveSeriesStarts, episodesBefore, type AniwaveCopies } from './sources';

export type ListedEpisode = EpisodeInfo & {
	/** The share this episode plays from, when it isn't the main entry's. */
	shareKey?: string;
	/** False for an episode TMDB lists but no source has. */
	available?: boolean;
	/** Its name from another source (an OVA's own name in Specials), when TMDB's won't do. */
	name?: string;
	airDate?: string | null;
};

/** `partial`: other sources were too slow to wait for this time; they'll be ready next time. */
export type EpisodeList = { seasons: number[]; episodes: ListedEpisode[]; qualities: string[]; partial?: boolean };

export type TmdbSeason = { number: number; name: string; count: number; airDate: string | null };
/** `anime`: Japanese animation, the shows other sources are asked about. */
export type TmdbShow = { id: number; name: string; anime: boolean; poster: string | null; seasons: TmdbSeason[] };
/** Another Showbox entry for the same show, and the TMDB season its season 1 is. */
type Companion = { title: string; shareKey: string; firstSeason: number };

const DAY = 24 * 60 * 60 * 1000;

/* ------------------------------------------------ saved answers */

function saved<T>(key: string, maxAge: number): T | undefined {
	const hit = getOrderCache(key);
	return hit && Date.now() - hit.at < maxAge ? (hit.value as T) : undefined;
}

function save(key: string, value: unknown): void {
	saveOrderCache(key, value, Date.now());
}

/* ------------------------------------------------ TMDB */

export async function tmdbShow(title: string, year: string): Promise<TmdbShow | null> {
	const key = `tmdb-show3|${normalizeTitle(title)}|${year}`;
	const known = saved<TmdbShow | null>(key, 3 * DAY);
	if (known !== undefined) return known;

	const found = await tmdbGet<{ results: { id: number }[] }>('/search/tv', {
		query: withoutQualifier(title),
		...(year ? { first_air_date_year: year } : {})
	});
	if (!found) return null; // couldn't ask: try again next time, don't remember
	const id = found.results[0]?.id;
	let show: TmdbShow | null = null;
	if (id) {
		type Season = { season_number: number; name: string; episode_count: number; air_date?: string | null };
		type Details = {
			name?: string;
			original_language?: string;
			genres?: { id: number }[];
			poster_path?: string | null;
			seasons?: Season[];
		};
		const details = await tmdbGet<Details>(`/tv/${id}`);
		if (!details) return null;
		show = {
			id,
			name: details.name ?? title,
			// TMDB's "Animation" genre is 16.
			anime: details.original_language === 'ja' && (details.genres ?? []).some((g) => g.id === 16),
			poster: details.poster_path ? `https://image.tmdb.org/t/p/w342${details.poster_path}` : null,
			seasons: (details.seasons ?? []).map((s) => ({
				number: s.season_number,
				name: s.name,
				count: s.episode_count,
				airDate: s.air_date ?? null
			}))
		};
	}
	save(key, show);
	return show;
}

/** When each episode of a season airs, for the greyed-out ones. */
async function airDates(showId: number, season: number): Promise<Map<number, string | null>> {
	const key = `tmdb-airdates|${showId}|${season}`;
	let list = saved<{ episode: number; airDate: string | null }[]>(key, DAY);
	if (!list) {
		type Episode = { episode_number: number; air_date: string | null };
		const data = await tmdbGet<{ episodes?: Episode[] }>(`/tv/${showId}/season/${season}`);
		if (!data) return new Map();
		list = (data.episodes ?? []).map((e) => ({ episode: e.episode_number, airDate: e.air_date }));
		save(key, list);
	}
	return new Map(list.map((e) => [e.episode, e.airDate]));
}

/* ------------------------------------------------ finding the other entries */

const words = (title: string) => normalizeTitle(withoutQualifier(title));

/** What a Showbox title adds to the main one: "Steel Ball Run: JoJo's Bizarre Adventure" → "steel ball run". */
function extraName(title: string, main: string): string {
	return words(title).replace(words(main), ' ').replace(/\s+/g, ' ').trim();
}

/** A season of the main show whose name is that extra part ("STEEL BALL RUN"). */
function seasonNamed(show: TmdbShow, extra: string): TmdbSeason | null {
	if (!extra) return null;
	return (
		show.seasons.find((s) => {
			const name = normalizeTitle(s.name);
			if (!name || /^season \d+$/.test(name) || name === 'specials') return false;
			return name === extra || name.includes(extra) || extra.includes(name);
		}) ?? null
	);
}

async function findCompanions(mainTitle: string, mainId: number, show: TmdbShow, main: EpisodeList): Promise<Companion[]> {
	const key = `companions|${mainId}`;
	const known = saved<Companion[]>(key, 3 * DAY);
	if (known) return known;

	const results = await searchShowbox(mainTitle);
	const mainWords = words(mainTitle);
	const candidates = results
		.filter((r: ShowboxResult) => r.type === 'tv' && r.id !== mainId && words(r.title) !== mainWords)
		.filter((r) => ` ${words(r.title)} `.includes(` ${mainWords} `))
		.slice(0, 3);

	const companions: Companion[] = [];
	for (const candidate of candidates) {
		const extra = extraName(candidate.title, mainTitle);
		let season = seasonNamed(show, extra)?.number ?? null;

		if (season === null) {
			// Not named after a season: it joins only if TMDB files it under the same show,
			// as the first season the main entry is short of.
			const found = await tmdbGet<{ results: { id: number }[] }>('/search/tv', { query: withoutQualifier(candidate.title) });
			if (found?.results[0]?.id !== show.id) continue;
			const have = (n: number) => main.episodes.filter((e) => e.season === n).length;
			const last = Math.max(0, ...main.seasons);
			season = show.seasons.find((s) => s.number >= Math.max(1, last) && have(s.number) < s.count)?.number ?? null;
			if (season === null) continue;
		}

		let id = candidate.id;
		if (!id && candidate.slug) id = await resolveSlugId(candidate.slug, 'tv');
		const link = id ? await getFebboxLink(id, 'tv') : null;
		const shareKey = link ? extractShareKey(link) : null;
		if (shareKey) companions.push({ title: candidate.title, shareKey, firstSeason: season });
	}

	save(key, companions);
	return companions;
}

/* ------------------------------------------------ Showbox's own season numbering */

/** Where each TMDB season ends, counting every episode from the show's first. */
function tmdbSeasonEnds(show: TmdbShow): number[] {
	const ends: number[] = [];
	let total = 0;
	for (const s of show.seasons.filter((s) => s.number > 0).sort((a, b) => a.number - b.number)) {
		total += s.count;
		ends.push(total);
	}
	return ends;
}

/**
 * Showbox sometimes files episodes under their number in the whole series instead of in their
 * season: Black Clover's "season 1" holds S01E52 to S01E128, which are really seasons 2 and 3,
 * and its "season 4" holds S04E53 (season 2's episode 2). Those are moved to where they belong
 * (beside Showbox's own copy, when it has one) and each season's length is worked out.
 *
 * Only done when Showbox's seasons don't fit TMDB's anyway (one has more episodes than TMDB's
 * season of that number) and it's certain: Showbox's seasons must add up to exactly where one of
 * TMDB's seasons ends (Black Clover: 51 + 51 + 52 + 16 = 170, TMDB's one long season).
 *
 * Each later season's length is its own episodes, which run on from 1 with small gaps (an episode
 * Showbox lacks); one more than ten past the last of them is numbered from the series' start.
 * Season 1's length is its own run when that adds up; otherwise it's what's left of TMDB's total
 * (Black Clover's season 1 folder holds the whole series: everything past 51 belongs later).
 *
 * Returns each Showbox season's length, or null when nothing was moved.
 */
function wholeSeriesNumbers(episodes: ListedEpisode[], show: TmdbShow): Map<number, number> | null {
	const seasons = [...new Set(episodes.map((e) => e.season))].filter((n) => n > 0).sort((a, b) => a - b);
	if (seasons[0] !== 1) return null;
	const own = (n: number) => episodes.filter((e) => e.season === n);
	const tooLong = seasons.some((n) => own(n).length > (show.seasons.find((s) => s.number === n)?.count ?? 0));
	if (!tooLong) return null;

	const lengths = new Map<number, number>();
	for (const n of seasons) {
		let run = 0;
		for (const e of own(n).sort((a, b) => a.episode - b.episode)) {
			if (e.episode - run > 10) break;
			run = e.episode;
		}
		lengths.set(n, run);
	}

	const ends = tmdbSeasonEnds(show);
	const sum = () => [...lengths.values()].reduce((a, b) => a + b, 0);
	if (!ends.includes(sum())) {
		const later = sum() - lengths.get(1)!;
		const end = ends.find((e) => e > later);
		const first = own(1);
		// Season 1 must really hold the later episodes: most of the series is in it.
		if (!end || first.length < (end * 2) / 3) return null;
		lengths.set(1, end - later);
	}
	const total = sum();
	if (!ends.includes(total)) return null;

	const strays = episodes.filter((e) => e.season > 0 && e.episode > lengths.get(e.season)!);
	if (!strays.length || strays.some((e) => e.episode > total)) return null;

	// Where each of Showbox's seasons begins, counting from the first episode.
	const before = new Map<number, number>();
	let passed = 0;
	for (const n of seasons) {
		before.set(n, passed);
		passed += lengths.get(n)!;
	}

	for (const stray of strays) {
		const season = [...seasons].reverse().find((n) => before.get(n)! < stray.episode)!;
		const episode = stray.episode - before.get(season)!;
		episodes.splice(episodes.indexOf(stray), 1);
		const there = episodes.find((e) => e.season === season && e.episode === episode && e.shareKey === stray.shareKey);
		if (there) {
			const fids = new Set(there.files.map((f) => f.fid));
			there.files = [...there.files, ...stray.files.filter((f) => !fids.has(f.fid))];
		} else {
			episodes.push({ ...stray, season, episode });
		}
	}
	return lengths;
}

/**
 * Moves another source's episodes (by TMDB season and episode) onto Showbox's seasons by
 * counting every episode from the show's first. Only when it's certain: each of Showbox's
 * seasons must begin exactly where one of Aniwave's series begins (Re:Zero's Showbox season 2
 * begins at episode 26, where Aniwave's second series does), or Showbox's seasons must add up
 * to exactly where one of TMDB's seasons ends (Black Clover's four make TMDB's one season of
 * 170). Null when they don't line up.
 *
 * `lengths`: each Showbox season's length, when worked out already; otherwise its last episode.
 */
async function onShowboxSeasons(
	others: Map<string, AniwaveCopies>,
	showbox: ListedEpisode[],
	show: TmdbShow,
	title: string,
	lengths: Map<number, number> | null
): Promise<Map<string, AniwaveCopies> | null> {
	const seasons = lengths
		? [...lengths.keys()].sort((a, b) => a - b)
		: [...new Set(showbox.map((e) => e.season))].filter((n) => n > 0).sort((a, b) => a - b);
	// Counting from the first episode needs Showbox to start at season 1.
	if (seasons[0] !== 1) return null;
	// Where each Showbox season begins, counting from the first episode (0 = before the first).
	const before = new Map<number, number>();
	let total = 0;
	for (const n of seasons) {
		before.set(n, total);
		total += lengths?.get(n) ?? Math.max(...showbox.filter((e) => e.season === n).map((e) => e.episode));
	}

	const toCount = (key: string) => {
		const [season, episode] = key.split('-').map(Number);
		return season > 0 ? episodesBefore(show, season) + episode : 0;
	};
	const last = Math.max(0, ...[...others.keys()].map(toCount));
	const starts = new Set(await aniwaveSeriesStarts(show, title));
	const endsWithTmdb = tmdbSeasonEnds(show).includes(total);
	const linedUp =
		endsWithTmdb ||
		seasons.every((n) => {
			const begins = before.get(n)! + 1;
			return begins === 1 || begins > last || starts.has(begins);
		});
	if (!linedUp) return null;

	const lastSeason = seasons[seasons.length - 1];
	const moved = new Map<string, AniwaveCopies>();
	for (const [key, files] of others) {
		// Specials aren't counted in; they stay in Specials.
		if (key.startsWith('0-')) {
			moved.set(key, files);
			continue;
		}
		const at = toCount(key);
		if (!at) continue;
		// Past the end of Showbox's seasons, when those end where a TMDB season does: TMDB's
		// next seasons follow on as new ones (Black Clover's 2026 season is Showbox's season 5).
		if (at > total && endsWithTmdb) {
			const [season, episode] = key.split('-').map(Number);
			const firstAfter = show.seasons.filter((s) => s.number > 0 && episodesBefore(show, s.number) >= total);
			const index = firstAfter.sort((a, b) => a.number - b.number).findIndex((s) => s.number === season);
			if (index >= 0) moved.set(`${lastSeason + 1 + index}-${episode}`, files);
			continue;
		}
		const season = [...seasons].reverse().find((n) => before.get(n)! < at)!;
		moved.set(`${season}-${at - before.get(season)!}`, files);
	}
	return moved;
}

/* ------------------------------------------------ putting it together */

/** Specials last; then by season and episode. */
const order = (a: ListedEpisode, b: ListedEpisode) =>
	(a.season === 0 ? 1000 : a.season) - (b.season === 0 ? 1000 : b.season) || a.episode - b.episode;

/**
 * The main entry's episodes, plus any other entry's, plus greyed-out placeholders.
 * Anything that goes wrong leaves the main list as it was.
 */
export async function combineEpisodes(
	main: EpisodeList,
	mainTitle: string,
	mainShowboxId: number,
	year: string
): Promise<EpisodeList> {
	try {
		const show = await tmdbShow(mainTitle, year);
		if (!show) return main;

		const episodes: ListedEpisode[] = main.episodes.map((e) => ({ ...e }));
		const have = new Set(episodes.map((e) => `${e.season}-${e.episode}`));
		const qualities = new Set(main.qualities);

		const companions = mainShowboxId ? await findCompanions(mainTitle, mainShowboxId, show, main) : [];
		for (const companion of companions) {
			const listed = await listEpisodes(`https://www.febbox.com/share/${companion.shareKey}`);
			const firstOwn = Math.min(...listed.seasons.filter((s) => s > 0), Infinity);
			for (const e of listed.episodes) {
				if (e.season === 0 || !Number.isFinite(firstOwn)) continue;
				const season = companion.firstSeason + (e.season - firstOwn);
				const key = `${season}-${e.episode}`;
				if (have.has(key)) continue; // the main entry's copy wins
				have.add(key);
				episodes.push({ ...e, season, shareKey: companion.shareKey });
				for (const f of e.files) if (f.quality) qualities.add(f.quality);
			}
		}

		// Episodes Showbox numbered from the series' start, moved to their own seasons.
		const lengths = wholeSeriesNumbers(episodes, show);
		if (lengths) {
			have.clear();
			for (const e of episodes) have.add(`${e.season}-${e.episode}`);
		}

		// Other sources and greyed-out placeholders go by TMDB's numbering — only when Showbox
		// numbers seasons the same way, or they'd point at the wrong episodes.
		const count = (n: number) => episodes.filter((e) => e.season === n).length;
		const sameNumbering = [...new Set(episodes.map((e) => e.season))].every((n) => {
			const tmdb = show.seasons.find((s) => s.number === n);
			return tmdb ? count(n) <= tmdb.count : n === 0;
		});

		// Aniwave's copies: alongside Showbox's files where both have an episode (Showbox's
		// stay first), and on their own where only Aniwave has it. Waited on for six seconds at
		// most when Showbox has the show (a slower answer is kept for next time); longer when
		// another source is all there is.
		let partial = false;
		let others: Map<string, AniwaveCopies> | null = null;
		if (show.anime) {
			const wait = mainShowboxId ? 6000 : 30000;
			others = await Promise.race([
				aniwaveFiles(show, mainTitle),
				new Promise<null>((resolve) => setTimeout(() => resolve(null), wait))
			]);
			if (!others) partial = true;
			// Showbox numbering seasons its own way (Re:Zero: TMDB has one season of 85, Showbox
			// four): Aniwave's episodes are moved onto Showbox's seasons, or left out if they
			// can't be lined up for certain.
			else if (!sameNumbering) {
				// When the seasons can't be lined up, the specials still can: they're numbered on their own.
				const specials = new Map([...others].filter(([key]) => key.startsWith('0-')));
				others = (await onShowboxSeasons(others, episodes, show, mainTitle, lengths)) ?? specials;
			}
		}
		if (others) {
			// OVAs and specials go after any specials Showbox already has, never onto one of them.
			const showboxSpecials = Math.max(0, ...episodes.filter((e) => e.season === 0).map((e) => e.episode));
			for (const [key, { files, name }] of others) {
				const [season, number] = key.split('-').map(Number);
				const episode = season === 0 ? showboxSpecials + number : number;
				const listed = episodes.find((e) => e.season === season && e.episode === episode);
				if (listed) listed.files = [...listed.files, ...files];
				else episodes.push({ season, episode, files, ...(name ? { name } : {}) });
				have.add(`${season}-${episode}`);
				for (const f of files) qualities.add(f.quality);
			}
		}

		const seasonsHere = [...new Set(episodes.map((e) => e.season))];
		if (sameNumbering) {
			for (const n of seasonsHere) {
				if (n === 0) continue;
				const tmdb = show.seasons.find((s) => s.number === n)!;
				if (count(n) >= tmdb.count) continue;
				const dates = await airDates(show.id, n);
				for (let ep = 1; ep <= tmdb.count; ep++) {
					if (have.has(`${n}-${ep}`)) continue;
					episodes.push({ season: n, episode: ep, files: [], available: false, airDate: dates.get(ep) ?? null });
				}
			}
		}

		episodes.sort(order);
		const seasons = [...new Set(episodes.map((e) => e.season))].sort((a, b) => (a === 0 ? 1000 : a) - (b === 0 ? 1000 : b));
		return {
			seasons,
			episodes,
			qualities: [...qualities].sort((a, b) => parseInt(b) - parseInt(a)),
			...(partial ? { partial } : {})
		};
	} catch (error) {
		console.warn('[episodes] could not combine:', error);
		return main;
	}
}
