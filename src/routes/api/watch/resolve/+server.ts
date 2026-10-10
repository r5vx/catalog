import { json, error } from '@sveltejs/kit';
import {
	searchShowbox,
	getFebboxLink,
	extractShareKey,
	listEpisodes,
	listMovieFiles,
	getStreamUrl,
	bestMatch,
	resolveSlugId
} from '$lib/server/showbox';
import { readSettings } from '$lib/server/settings';
import {
	findEntryByTitle,
	getSavedShowboxMatch,
	saveShowboxMatch,
	forgetShowboxMatch
} from '$lib/server/db/queries';
import { fetchAlternativeTitles, tmdbGet } from '$lib/server/metadata/tmdb';
import { fetchRomajiTitle } from '$lib/server/metadata/anilist';
import { combineEpisodes, tmdbShow, type EpisodeList } from '$lib/server/combinedEpisodes';
import { aniwaveFilm } from '$lib/server/sources';
import { aniwaveStream, parseAniwaveShareKey } from '$lib/server/sources/aniwave';
import type { RequestHandler } from './$types';

/**
 * A show's Showbox episodes. Showbox's file host sometimes refuses or doesn't answer for a
 * moment, which reads as an empty folder, so an empty answer is asked again once, shortly after.
 */
async function listShowboxEpisodes(shareUrl: string) {
	const listed = await listEpisodes(shareUrl);
	if (listed.episodes.length) return listed;
	await new Promise((resolve) => setTimeout(resolve, 1500));
	return listEpisodes(shareUrl);
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

async function findOnShowbox(title: string, type: string, year: string) {
	const results = await searchShowbox(title);
	if (!results.length) return null;
	return bestMatch(results, title, type, year);
}

/**
 * Not on Showbox at all: an anime another source (Aniwave) has. Same one-list-per-show
 * numbering as everything else. Null when no source has it.
 */
async function fromOtherSources(title: string, year: string) {
	const seasonPart = title.match(/\s+(season|s)\s*(\d+)\s*$/i);
	const base = seasonPart ? title.replace(/\s+(season|s)\s*\d+\s*$/i, '').trim() : title;
	// A later season's year isn't the year the show started.
	const showYear = seasonPart ? '' : year;
	const show = await tmdbShow(base, showYear);
	if (!show?.anime) return null;
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

export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim();
	const type = url.searchParams.get('type') ?? '';
	const year = url.searchParams.get('year') ?? '';
	// For series the player picks the episode itself, then asks for that stream.
	const skipEpisodeStream = url.searchParams.get('nostream') === '1';

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

	if (cached && Date.now() - cached.time < RESOLVE_TTL) {
		matchTitle = cached.match.title;
		matchId = cached.match.id;
		matchType = cached.match.type;
		matchPosterUrl = cached.match.posterUrl;
		shareKey = cached.shareKey;
		episodeData = cached.episodes;
		movieFileList = cached.files;
		startSeason = cached.startSeason;
	} else {
		// Remembered from an earlier session: skips the Showbox search, but re-lists so new episodes show.
		const saved = getSavedShowboxMatch(cacheKey);
		let restored = false;
		/** Playing from another source because Showbox's folder came back empty this time. */
		let otherInstead = false;
		if (saved) {
			const shareUrl = `https://www.febbox.com/share/${saved.shareKey}`;
			if (saved.type === 'tv') {
				const listed = await listShowboxEpisodes(shareUrl);
				if (listed.episodes.length) { episodeData = listed; restored = true; }
			} else {
				const files = await listMovieFiles(shareUrl);
				if (files.length) { movieFileList = files; restored = true; }
			}
			if (restored) {
				matchTitle = saved.title;
				matchId = saved.showboxId;
				matchType = saved.type;
				matchPosterUrl = saved.posterUrl || undefined;
				shareKey = saved.shareKey;
				startSeason = saved.startSeason;
			} else if (saved.type === 'tv') {
				// An empty folder is almost always Showbox's file host refusing for a while (too many
				// listings), not the show being gone — so the match is kept, and another source plays
				// it in the meantime if it has it.
				const other = await fromOtherSources(saved.title, year);
				if (other) {
					matchTitle = other.title;
					matchType = 'tv';
					episodeData = other.episodes;
					startSeason = other.startSeason;
					otherInstead = true;
				}
			} else {
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
				// An anime film Showbox doesn't have (Re:Zero's Memory Snow): from Aniwave.
				const film = await aniwaveFilm(title, year);
				if (!film) return json({ error: 'not_found' });
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
					const listed = await listShowboxEpisodes(link);
					episodeData = listed;
					if (!listed.episodes.length) {
						// Same as above: another source plays it while Showbox's folder comes back empty.
						const other = await fromOtherSources(match.title, year);
						if (!other) return json({ error: 'no_file' });
						matchTitle = other.title;
						episodeData = other.episodes;
						startSeason = other.startSeason;
						shareKey = '';
						otherInstead = true;
					}
				} else {
					const files = await listMovieFiles(link);
					if (!files.length) return json({ error: 'no_file' });
					movieFileList = files;
				}

				if (!otherInstead) saveShowboxMatch(cacheKey, {
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
		const firstFile = targetEp?.files[0];
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
			episodes: epData,
			debug: streamDebug,
			posterUrl,
			libraryEntry,
			startSeason
		});
	}

	const files = movieFileList as { fid: number; quality: string; name: string; size: string; shareKey?: string }[];
	const defaultFile =
		files.find((f) => f.quality === '1080p') ??
		files.find((f) => f.quality === '720p') ??
		files[0];

	let streamUrl = '';
	let streamDebug: string | undefined;
	const aniwave = parseAniwaveShareKey(defaultFile.shareKey ?? '');
	if (aniwave) {
		// Another source's film plays through Catalog's relay, like its episodes.
		const stream = await aniwaveStream(aniwave.id, aniwave.episode, aniwave.kind);
		if (stream) streamUrl = `/api/watch/relay?u=${encodeURIComponent(stream.url)}`;
	} else if (febboxToken) {
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
		files,
		debug: streamDebug,
		posterUrl,
		libraryEntry
	});
};
