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
import { findEntryByTitle } from '$lib/server/db/queries';
import { fetchAlternativeTitles } from '$lib/server/metadata/tmdb';
import { fetchRomajiTitle } from '$lib/server/metadata/anilist';
import type { RequestHandler } from './$types';

async function findOnShowbox(title: string, type: string, year: string) {
	const results = await searchShowbox(title);
	if (!results.length) return null;
	return bestMatch(results, title, type, year);
}

interface ResolveCache {
	match: { id: number; title: string; type: string; slug?: string; posterUrl?: string };
	shareKey: string;
	episodes?: unknown;
	files?: unknown[];
	time: number;
}
const resolveCache = new Map<string, ResolveCache>();
const RESOLVE_TTL = 30 * 60 * 1000;

export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim();
	const type = url.searchParams.get('type') ?? '';
	const year = url.searchParams.get('year') ?? '';

	if (!title) return error(400, 'Missing title');

	const cacheKey = `${title.toLowerCase()}:${type}:${year}`;
	const cached = resolveCache.get(cacheKey);
	let matchTitle: string;
	let matchId: number;
	let matchType: string;
	let matchPosterUrl: string | undefined;
	let shareKey: string;
	let episodeData: unknown | undefined;
	let movieFileList: unknown[] | undefined;

	if (cached && Date.now() - cached.time < RESOLVE_TTL) {
		matchTitle = cached.match.title;
		matchId = cached.match.id;
		matchType = cached.match.type;
		matchPosterUrl = cached.match.posterUrl;
		shareKey = cached.shareKey;
		episodeData = cached.episodes;
		movieFileList = cached.files;
	} else {
		let match = await findOnShowbox(title, type, year);

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

		if (!match) return json({ error: 'not_found' });

		if (match.id === 0 && match.slug) {
			match.id = await resolveSlugId(match.slug, match.type);
			if (match.id === 0) return json({ error: 'no_link' });
		}

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
			episodeData = await listEpisodes(link);
		} else {
			const files = await listMovieFiles(link);
			if (!files.length) return json({ error: 'no_file' });
			movieFileList = files;
		}

		resolveCache.set(cacheKey, {
			match: { id: matchId, title: matchTitle, type: matchType, posterUrl: matchPosterUrl },
			shareKey,
			episodes: episodeData,
			files: movieFileList,
			time: Date.now()
		});
	}

	const { febboxToken } = readSettings();
	const libraryEntry = findEntryByTitle(matchTitle);
	const posterUrl = libraryEntry?.posterUrl || matchPosterUrl || '';

	if (matchType === 'tv') {
		const epData = episodeData as { episodes: { season: number; episode: number; files: { fid: number; quality: string }[] }[]; seasons: number[]; qualities?: string[] };
		const firstEp = epData.episodes[0];
		const firstFile = firstEp?.files[0];
		let streamUrl = '';
		let streamDebug: string | undefined;

		if (firstFile && febboxToken) {
			const result = await getStreamUrl(shareKey, firstFile.fid, febboxToken);
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
			libraryEntry
		});
	}

	const files = movieFileList as { fid: number; quality: string; name: string; size: string }[];
	const defaultFile =
		files.find((f) => f.quality === '1080p') ??
		files.find((f) => f.quality === '720p') ??
		files[0];

	let streamUrl = '';
	let streamDebug: string | undefined;
	if (febboxToken) {
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
