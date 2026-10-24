import { json, error } from '@sveltejs/kit';
import {
	searchShowbox,
	getFebboxLink,
	extractShareKey,
	listEpisodes,
	listMovieFiles,
	getStreamUrl,
	FebboxRefused,
	bestMatch,
	resolveSlugId
} from '$lib/server/showbox';
import { readSettings, febboxAccountOf } from '$lib/server/settings';
import {
	findEntryByTitle,
	getSavedShowboxMatch,
	saveShowboxMatch,
	forgetShowboxMatch,
	watchedEpisodesForTitle
} from '$lib/server/db/queries';
import { pickFile, PREFERRED_QUALITY } from '$lib/watch';
import { fetchAlternativeTitles, tmdbGet } from '$lib/server/metadata/tmdb';
import { fetchRomajiTitle } from '$lib/server/metadata/anilist';
import { combineEpisodes, tmdbShow, type EpisodeList } from '$lib/server/combinedEpisodes';
import { aniwaveFilm } from '$lib/server/sources';
import { aniwaveStream, parseAniwaveShareKey } from '$lib/server/sources/aniwave';
import { vidriftCopies, vidriftStream } from '$lib/server/sources/vidrift';
import { movyCopy, movyStream } from '$lib/server/sources/movy';
import type { FileOption } from '$lib/server/showbox';
import type { RequestHandler } from './$types';

/**
 * A Showbox folder listing, or how long until Febbox will list again. Febbox's host refuses
 * listings for a while after too many (febboxList.ts); that's "busy", never "no files" — taking it
 * for "no files" is what made Spider-Man: Brand New Day's Showbox files vanish and stay gone.
 */
async function listing<T>(work: Promise<T>): Promise<{ value: T } | { busy: number }> {
	try {
		return { value: await work };
	} catch (e) {
		if (e instanceof FebboxRefused) return { busy: Math.max(5, e.retryInSeconds) };
		throw e;
	}
}

/** TMDB's poster for a film, for one only another source has (no Showbox poster). */
async function tmdbFilmPoster(title: string, year: string): Promise<string | null> {
	const found = await tmdbGet<{ results: { title?: string; poster_path?: string | null }[] }>('/search/movie', {
		query: title,
		...(year ? { year } : {})
	});
	// The one named exactly that: TMDB's top hit for one Re:Zero film can be the other.
	const film = found?.results.find((r) => r.title?.toLowerCase() === title.toLowerCase()) ?? found?.results[0];
	const path = film?.poster_path;
	return path ? `https://image.tmdb.org/t/p/w342${path}` : null;
}

/** A film's TMDB id: the one named exactly that (in that year, when known), else TMDB's top hit. */
async function tmdbFilmId(title: string, year: string): Promise<number | null> {
	type Found = { results: { id: number; title?: string; release_date?: string }[] };
	const found = await tmdbGet<Found>('/search/movie', { query: title, ...(year ? { year } : {}) });
	const same = (t?: string) => t?.toLowerCase() === title.toLowerCase();
	const film = found?.results.find((r) => same(r.title)) ?? found?.results[0];
	return film?.id ?? null;
}

/** 7Movies' and Movy's copies of a film, which play alongside (or instead of) Showbox's. */
async function filmCopies(title: string, year: string): Promise<FileOption[]> {
	const id = await tmdbFilmId(title, year).catch(() => null);
	if (!id) return [];
	const what = { type: 'movie' as const, id, season: 0, episode: 0 };
	return [...vidriftCopies(what), movyCopy(what)];
}

async function findOnShowbox(title: string, type: string, year: string) {
	const results = await searchShowbox(title);
	if (!results.length) return null;
	return bestMatch(results, title, type, year);
}

/**
 * Not on Showbox at all: a show other sources have (7Movies; Aniwave for anime). Same
 * one-list-per-show numbering as everything else. Null when no source has it.
 */
async function fromOtherSources(title: string, year: string) {
	const seasonPart = title.match(/\s+(season|s)\s*(\d+)\s*$/i);
	const base = seasonPart ? title.replace(/\s+(season|s)\s*\d+\s*$/i, '').trim() : title;
	// A later season's year isn't the year the show started.
	const showYear = seasonPart ? '' : year;
	const show = await tmdbShow(base, showYear);
	if (!show) return null;
	const episodes = await combineEpisodes({ seasons: [], episodes: [], qualities: [] }, base, 0, showYear);
	if (!episodes.episodes.some((e) => e.available !== false && e.files.length)) return null;
	return { title: base, episodes, startSeason: seasonPart ? Number(seasonPart[2]) : 0 };
}

interface ResolveCache {
	match: { id: number; title: string; type: string; slug?: string; posterUrl?: string };
	shareKey: string;
	episodes?: unknown;
	files?: unknown[];
	startSeason: number;
	time: number;
}
const resolveCache = new Map<string, ResolveCache>();
const RESOLVE_TTL = 30 * 60 * 1000;

/**
 * The video link for the episode the player will most likely start, fetched now, while the rest
 * of the lookup and the player's own steps go on — the player's request for it then picks up
 * the one already under way (getStreamUrl shares it) instead of starting from nothing, about 2 s
 * sooner. Chosen the way the player chooses: the episode asked for, else where the title was
 * left (the next one if that was finished), else the season Showbox's entry starts at, else the
 * first; Showbox's best file. A wrong guess costs one extra lookup and nothing else.
 */
/** The title other sources' links were last warmed for. */
let warming = '';

function warmLikelyEpisode(list: EpisodeList, share: string, title: string, startSeason: number, asked: { season: number; episode: number }) {
	if (!list.episodes.length) return;
	const episodes = list.episodes;
	const at = (season: number, episode: number) => episodes.find((e) => e.season === season && e.episode === episode);
	let target = asked.season && asked.episode ? at(asked.season, asked.episode) : undefined;
	if (!target && !asked.season) {
		const watched = watchedEpisodesForTitle(title);
		if (watched.length) {
			const last = watched.reduce((best, e) => (e.season > best.season || (e.season === best.season && e.episode > best.episode) ? e : best));
			const index = episodes.findIndex((e) => e.season === last.season && e.episode === last.episode);
			target = last.pct >= 0.9 && index >= 0 ? episodes[index + 1] : at(last.season, last.episode);
		}
		if (!target && startSeason) target = episodes.find((e) => e.season === startSeason);
	}
	target ??= episodes[0];
	const plays = (e: (typeof episodes)[number]) => e.available !== false && e.files.length > 0;
	if (!plays(target)) target = episodes.find((e) => e.season === target!.season && plays(e)) ?? episodes.find(plays);
	if (!target) return;
	// No Showbox copy: 7Movies' and Movy's links are looked up now instead, as checks that make
	// way for anything about to play. Movy takes 15–20 s on its own: SVU S28E3, on Movy before
	// 7Movies had it, took 25 s to start.
	if (!target.files.some((f) => !f.source)) {
		// (Called off once another title is warmed: the TV's highlight passing over shows doesn't
		// queue Movy's searches up.)
		warming = title;
		const stillWanted = () => warming === title;
		for (const copy of target.files) {
			if (!copy.shareKey) continue;
			if (copy.source === '7Movies') vidriftStream(copy.shareKey).catch(() => null);
			else if (copy.source === 'Movy') movyStream(copy.shareKey, false, { start: stillWanted, keep: stillWanted }).catch(() => null);
		}
		return;
	}
	const { febboxToken } = readSettings();
	const file = pickFile(target.files, PREFERRED_QUALITY);
	if (!febboxToken || !file || file.source || !(target.shareKey ?? share)) return;
	getStreamUrl(target.shareKey ?? share, file.fid, febboxToken).catch(() => {});
}

/**
 * Lookups of one title wait for each other: a Watch button pointed at starts one (src/lib/watch.ts
 * warmUpTitle), and the player's own, a moment later, then gets its answer from what that one
 * kept instead of doing the same Showbox search and Febbox listing a second time beside it.
 */
const lookingUp = new Map<string, Promise<unknown>>();

export const GET: RequestHandler = async (event) => {
	const params = event.url.searchParams;
	const key = `${params.get('title')?.trim().toLowerCase()}:${params.get('type') ?? ''}:${params.get('year') ?? ''}`;
	const before = lookingUp.get(key);
	const mine = (before ?? Promise.resolve()).catch(() => {}).then(() => lookUp(event.url));
	lookingUp.set(key, mine);
	try {
		return await mine;
	} finally {
		if (lookingUp.get(key) === mine) lookingUp.delete(key);
	}
};

async function lookUp(url: URL): Promise<Response> {
	const title = url.searchParams.get('title')?.trim();
	const type = url.searchParams.get('type') ?? '';
	const year = url.searchParams.get('year') ?? '';
	// For series the player picks the episode itself, then asks for that stream.
	const skipEpisodeStream = url.searchParams.get('nostream') === '1';
	// The player (or a Watch button pointed at) wants the likely episode's link started.
	const warm = skipEpisodeStream && url.searchParams.get('warm') === '1';
	const asked = { season: Number(url.searchParams.get('resume_s') ?? 0), episode: Number(url.searchParams.get('resume_e') ?? 0) };

	if (!title) return error(400, 'Missing title');

	const cacheKey = `${title.toLowerCase()}:${type}:${year}`;
	const cached = resolveCache.get(cacheKey);
	let matchTitle = '';
	let matchId = 0;
	let matchType = '';
	let matchPosterUrl: string | undefined;
	let shareKey = '';
	let episodeData: unknown | undefined;
	let movieFileList: unknown[] | undefined;
	let startSeason = 0;
	/** Seconds until Febbox lists folders again, when it refused Showbox's just now (else 0). */
	let showboxBusy = 0;

	if (cached && Date.now() - cached.time < RESOLVE_TTL) {
		matchTitle = cached.match.title;
		matchId = cached.match.id;
		matchType = cached.match.type;
		matchPosterUrl = cached.match.posterUrl;
		shareKey = cached.shareKey;
		episodeData = cached.episodes;
		movieFileList = cached.files;
		startSeason = cached.startSeason;
		if (warm && matchType === 'tv' && episodeData) warmLikelyEpisode(episodeData as EpisodeList, shareKey ?? '', matchTitle, startSeason, asked);
	} else {
		// Remembered from an earlier session: skips the Showbox search, but re-lists so new episodes show.
		const saved = getSavedShowboxMatch(cacheKey);
		let restored = false;
		/** Playing from another source because Showbox's folder came back empty this time. */
		let otherInstead = false;
		if (saved) {
			const shareUrl = `https://www.febbox.com/share/${saved.shareKey}`;
			if (saved.type === 'tv') {
				const listed = await listing(listEpisodes(shareUrl));
				if ('busy' in listed) showboxBusy = listed.busy;
				else if (listed.value.episodes.length) { episodeData = listed.value; restored = true; }
			} else {
				const [listed, sevenMovies] = await Promise.all([listing(listMovieFiles(shareUrl)), filmCopies(title, year)]);
				if ('busy' in listed) {
					// Febbox busy: the match stays; 7Movies plays meanwhile, and Showbox's files join
					// when the player asks again.
					showboxBusy = listed.busy;
					if (!sevenMovies.length) return json({ error: 'busy', retryIn: showboxBusy });
					matchTitle = saved.title;
					matchType = 'movie';
					movieFileList = sevenMovies;
					otherInstead = true;
				} else if (listed.value.length) { movieFileList = [...listed.value, ...sevenMovies]; restored = true; }
			}
			if (restored) {
				matchTitle = saved.title;
				matchId = saved.showboxId;
				matchType = saved.type;
				matchPosterUrl = saved.posterUrl || undefined;
				shareKey = saved.shareKey;
				startSeason = saved.startSeason;
			} else if (saved.type === 'tv') {
				// Busy, or an empty folder (which can be the host acting up too): the match is kept,
				// and another source plays it in the meantime if it has it.
				const other = await fromOtherSources(saved.title, year);
				if (other) {
					matchTitle = other.title;
					matchType = 'tv';
					episodeData = other.episodes;
					startSeason = other.startSeason;
					otherInstead = true;
				} else if (showboxBusy) {
					return json({ error: 'busy', retryIn: showboxBusy });
				}
			} else if (!otherInstead) {
				// Listed, and really empty: the film's gone from that folder; looked for afresh.
				forgetShowboxMatch(cacheKey);
			}
		}

		if (!restored && !otherInstead) {
			let match = await findOnShowbox(title, type, year);

			if (!match) {
				const seasonPart = title.match(/\s+(season|s)\s*(\d+)\s*$/i);
				const partPart = title.match(/\s+(part)\s*(\d+)\s*$/i);
				if (seasonPart || partPart) {
					const cleaned = title.replace(/\s+(season|part|s)\s*\d+\s*$/i, '').trim();
					if (cleaned.length >= 2) {
						const forceType = seasonPart ? 'tv' : type;
						match = await findOnShowbox(cleaned, forceType, year);
						if (match && seasonPart) startSeason = Number(seasonPart[2]);
					}
				}
			}

			if (!match) {
				const altTitles: string[] = [];
				const tmdbType = type === 'movie' ? 'movie' as const : 'tv' as const;
				const tmdbAlts = await fetchAlternativeTitles(title, tmdbType);
				altTitles.push(...tmdbAlts);
				if (type === 'tv' || !type) {
					const romaji = await fetchRomajiTitle(title);
					if (romaji && !altTitles.includes(romaji)) altTitles.push(romaji);
				}
				const origWords = new Set(title.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 1));
				for (const alt of altTitles) {
					const candidate = await findOnShowbox(alt, type, year);
					if (!candidate) continue;
					const matchWords = candidate.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 1);
					const altWords = alt.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 1);
					const related = matchWords.some(w => origWords.has(w)) || altWords.some(w => origWords.has(w));
					if (related) { match = candidate; break; }
				}
			}

			if (!match && type === 'movie') {
				// A film Showbox doesn't have: an anime one from Aniwave (Re:Zero's Memory Snow),
				// any from 7Movies (Thor: Love and Thunder).
				const [anime, sevenMovies] = await Promise.all([aniwaveFilm(title, year), filmCopies(title, year)]);
				const film = [...(anime ?? []), ...sevenMovies];
				if (!film.length) return json({ error: 'not_found' });
				matchTitle = title;
				matchType = 'movie';
				movieFileList = film;
			} else if (!match) {
				const other = await fromOtherSources(title, year);
				if (!other) return json({ error: 'not_found' });
				matchTitle = other.title;
				matchType = 'tv';
				episodeData = other.episodes;
				startSeason = other.startSeason;
			}

			if (match && match.id === 0 && match.slug) {
				match.id = await resolveSlugId(match.slug, match.type);
				if (match.id === 0) return json({ error: 'no_link' });
			}

			if (match) {
				const link = await getFebboxLink(match.id, match.type);
				if (!link) return json({ error: 'no_link' });

				const sk = extractShareKey(link);
				if (!sk) return json({ error: 'no_link' });

				matchTitle = match.title;
				matchId = match.id;
				matchType = match.type;
				matchPosterUrl = match.posterUrl;
				shareKey = sk;

				if (match.type === 'tv') {
					const answer = await listing(listEpisodes(link));
					if ('busy' in answer) showboxBusy = answer.busy;
					const listed = 'busy' in answer ? { seasons: [], episodes: [], qualities: [] } : answer.value;
					episodeData = listed;
					if (!listed.episodes.length) {
						// Same as above: another source plays it while Showbox's folder is busy or empty.
						const other = await fromOtherSources(match.title, year);
						if (!other) return json(showboxBusy ? { error: 'busy', retryIn: showboxBusy } : { error: 'no_file' });
						matchTitle = other.title;
						episodeData = other.episodes;
						startSeason = other.startSeason;
						shareKey = '';
						otherInstead = true;
					}
				} else {
					// Showbox's files, then 7Movies' (played when Showbox's won't, or picked).
					const [answer, sevenMovies] = await Promise.all([listing(listMovieFiles(link)), filmCopies(title, year)]);
					if ('busy' in answer) {
						showboxBusy = answer.busy;
						otherInstead = true;
					}
					const files = 'busy' in answer ? [] : answer.value;
					if (!files.length && !sevenMovies.length) return json(showboxBusy ? { error: 'busy', retryIn: showboxBusy } : { error: 'no_file' });
					movieFileList = [...files, ...sevenMovies];
				}

				// (Found on Showbox even when its folder was busy: next time skips the search.)
				if (!otherInstead || showboxBusy) saveShowboxMatch(cacheKey, {
					showboxId: matchId,
					title: matchTitle,
					type: matchType,
					posterUrl: matchPosterUrl ?? '',
					shareKey,
					startSeason
				});
			}
		}

		// Other Showbox entries for the same show (JoJo's Steel Ball Run) and other sources join
		// the list, and episodes no one has yet show greyed out. (Already done for a show only
		// other sources have.)
		if (warm && matchType === 'tv' && episodeData) warmLikelyEpisode(episodeData as EpisodeList, shareKey ?? '', matchTitle, startSeason, asked);
		if (matchType === 'tv' && episodeData && shareKey) {
			episodeData = await combineEpisodes(episodeData as EpisodeList, matchTitle, matchId, year);
		}

		// Not kept when another source was too slow this time (so it joins on the next visit), or
		// when Showbox's folder came back empty (so Showbox is back as soon as it answers again).
		if (!(episodeData as EpisodeList | undefined)?.partial && !otherInstead) resolveCache.set(cacheKey, {
			match: { id: matchId, title: matchTitle, type: matchType, posterUrl: matchPosterUrl },
			shareKey,
			episodes: episodeData,
			files: movieFileList,
			startSeason,
			time: Date.now()
		});
	}

	const { febboxToken } = readSettings();
	const libraryEntry = findEntryByTitle(matchTitle);
	// The library's poster, else TMDB's (Showbox's can be missing or broken, and a show only
	// another source has has none) — it's what Continue Watching shows.
	const tmdbPoster = libraryEntry?.posterUrl
		? null
		: matchType === 'tv'
			? (await tmdbShow(matchTitle, year))?.poster
			: !matchPosterUrl
				? await tmdbFilmPoster(matchTitle, year)
				: null;
	const posterUrl = libraryEntry?.posterUrl || tmdbPoster || matchPosterUrl || '';

	if (matchType === 'tv') {
		const epData = episodeData as EpisodeList;
		// The first episode that can be played, specials aside.
		const playable = epData.episodes.filter((ep) => ep.available !== false && ep.files.length > 0);
		let targetEp = playable.find((ep) => ep.season > 0) ?? playable[0];
		if (startSeason > 0) {
			const seasonEp = playable.find(ep => ep.season === startSeason);
			if (seasonEp) targetEp = seasonEp;
		}
		// The file the player will pick (warming another one's link was wasted).
		const firstFile = targetEp ? (pickFile(targetEp.files, PREFERRED_QUALITY) ?? targetEp.files[0]) : undefined;
		// An episode from another Showbox entry plays from that entry's share.
		const targetShare = targetEp?.shareKey ?? shareKey;
		let streamUrl = '';
		let streamDebug: string | undefined;

		if (firstFile && !firstFile.source && febboxToken && !skipEpisodeStream) {
			const result = await getStreamUrl(targetShare, firstFile.fid, febboxToken);
			streamUrl = result.url ?? '';
			streamDebug = result.debug;
		}

		return json({
			title: matchTitle,
			showboxId: matchId,
			type: matchType,
			shareKey,
			streamUrl,
			fid: firstFile?.fid ?? 0,
			hasToken: Boolean(febboxToken),
			febboxAccount: febboxAccountOf(febboxToken),
			episodes: epData,
			debug: streamDebug,
			posterUrl,
			libraryEntry,
			startSeason,
			// Showbox's folder couldn't be listed just now: the player asks again in this many seconds.
			showboxBusy
		});
	}

	const files = movieFileList as FileOption[];
	// Showbox's best file first; the player asks for another source's link itself.
	const showboxFiles = files.filter((f) => !f.source);
	const defaultFile = pickFile(showboxFiles, PREFERRED_QUALITY) ?? showboxFiles[0] ?? files[0];

	let streamUrl = '';
	let streamDebug: string | undefined;
	const aniwave = parseAniwaveShareKey(defaultFile.shareKey ?? '');
	if (aniwave) {
		// Another source's film plays through Catalog's relay, like its episodes.
		const stream = await aniwaveStream(aniwave.id, aniwave.episode, aniwave.kind);
		if (stream) streamUrl = `/api/watch/relay?u=${encodeURIComponent(stream.url)}`;
	} else if (febboxToken && !defaultFile.source) {
		const result = await getStreamUrl(shareKey, defaultFile.fid, febboxToken);
		streamUrl = result.url ?? '';
		streamDebug = result.debug;
	}

	return json({
		title: matchTitle,
		showboxId: matchId,
		type: matchType,
		shareKey,
		streamUrl,
		fid: defaultFile.fid,
		hasToken: Boolean(febboxToken),
		febboxAccount: febboxAccountOf(febboxToken),
		files,
		debug: streamDebug,
		posterUrl,
		libraryEntry,
		showboxBusy
	});
}
