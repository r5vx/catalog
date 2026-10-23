/**
 * Intro, recap and credits from Anime Skip (anime-skip.com): the community database behind its
 * Crunchyroll browser extension, a second source beside AniSkip (skiptimes.ts). It covers shows
 * AniSkip is thin on (all of Re:Zero, Frieren, most of Bleach).
 *
 * Each episode is a list of where each part starts ("Intro" at 93 s, "Canon" at 183 s…), timed
 * on Crunchyroll's copy, whose length comes with it: the times are only used on a file within
 * 30 s of that length, so another cut never gets them.
 *
 * Its API allows 60 requests a minute for this client ID. A show's episodes come in one request
 * (after one search), kept for a day, so watching costs two requests a show a day at most.
 */
import { getOrderCache, saveOrderCache } from '../db/queries';
import type { SkipSegment } from './skiptimes';

const API = 'https://api.anime-skip.com/graphql';
/** Catalog's own client ID (the owner's anime-skip.com account). */
const CLIENT_ID = 'MRbi2djb4SaLMQbv0qishy9ELZSmO894';
const DAY = 24 * 60 * 60 * 1000;

type Stamp = { at: number; type: { name: string } | null };
type Episode = { season: string | null; number: string | null; absoluteNumber: string | null; baseDuration: number | null; timestamps: Stamp[] };

/** Which of Anime Skip's kinds of part Catalog can skip. ("Canon", "Preview", "Title Card"… aren't.) */
function kindOf(name: string): SkipSegment['type'] | null {
	if (/intro/i.test(name)) return 'intro';
	if (/credits/i.test(name)) return 'credits';
	if (/recap/i.test(name)) return 'recap';
	return null;
}

const normalize = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

async function ask<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
	try {
		const resp = await fetch(API, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Client-ID': CLIENT_ID },
			body: JSON.stringify({ query, variables }),
			signal: AbortSignal.timeout(8000)
		});
		if (!resp.ok) return null;
		const body = (await resp.json()) as { data?: T; errors?: unknown };
		return body.errors ? null : (body.data ?? null);
	} catch {
		return null;
	}
}

/**
 * Every episode of every Anime Skip show named like `title` (one show can be listed a few times:
 * Re:Zero is, by season). Kept a day; null when Anime Skip couldn't be asked.
 */
async function episodesFor(title: string): Promise<Episode[] | null> {
	const key = `animeskip|${normalize(title)}`;
	const kept = getOrderCache(key);
	if (kept && Date.now() - kept.at < DAY) return kept.value as Episode[];

	const found = await ask<{ searchShows: { id: string; name: string; originalName: string | null }[] }>(
		'query($s: String!) { searchShows(search: $s, limit: 10) { id name originalName } }',
		{ s: title }
	);
	if (!found) return (kept?.value as Episode[] | undefined) ?? null;
	// Named the show, give or take a season: "Re:ZERO … Season 2" is the same show, another one
	// that merely starts the same isn't.
	const wanted = normalize(title);
	const shows = found.searchShows.filter((s) =>
		[s.name, s.originalName].some((n) => n && normalize(n.replace(/\b(season|part|cour)\s*\d+\b|\b\d+(st|nd|rd|th)\s+season\b/gi, '')) === wanted)
	);
	const episodes: Episode[] = [];
	for (const show of shows.slice(0, 3)) {
		const answer = await ask<{ findEpisodesByShowId: Episode[] }>(
			'query($id: ID!) { findEpisodesByShowId(showId: $id) { season number absoluteNumber baseDuration timestamps { at type { name } } } }',
			{ id: show.id }
		);
		if (answer) episodes.push(...answer.findEpisodesByShowId.filter((e) => e.timestamps?.length));
	}
	saveOrderCache(key, episodes, Date.now());
	return episodes;
}

/**
 * The skippable parts of one episode, as Anime Skip has them. `season`/`episode`: the player's
 * numbering; `overall`: counted from the show's first episode (Crunchyroll often numbers that way).
 * `duration`: the real file's length in seconds.
 */
export async function animeSkipTimes(title: string, season: number, episode: number, overall: number, duration: number): Promise<SkipSegment[]> {
	const episodes = await episodesFor(title);
	if (!episodes?.length) return [];
	const n = (v: string | null) => (v === null ? NaN : Number(v));
	// The same season and episode first, then the number counted from the start.
	const candidates = [
		...episodes.filter((e) => n(e.season) === season && n(e.number) === episode),
		...episodes.filter((e) => n(e.absoluteNumber) === overall || (n(e.number) === overall && (e.season === null || n(e.season) === 1)))
	];
	// Timed against this cut (or one within 30 s of it): other cuts' times would be off.
	const match = candidates.find((e) => e.baseDuration && Math.abs(e.baseDuration - duration) <= 30);
	if (!match) return [];
	return partsOf(match, duration);
}

/**
 * Which kinds of part have the story going on over the song in this episode, in any cut ("Mixed
 * Credits"). That's the episode, not the cut: a copy a minute shorter has the same scene under its
 * ending (Re:Zero S2E16: Anime Skip has it at 29:30, IntroDB's plain outro fits a 28:33 copy).
 */
export async function animeSkipMixed(title: string, season: number, episode: number, overall: number): Promise<SkipSegment['type'][]> {
	const episodes = await episodesFor(title);
	if (!episodes?.length) return [];
	const n = (v: string | null) => (v === null ? NaN : Number(v));
	const candidates = episodes.filter(
		(e) =>
			(n(e.season) === season && n(e.number) === episode) ||
			n(e.absoluteNumber) === overall ||
			(n(e.number) === overall && (e.season === null || n(e.season) === 1))
	);
	const kinds = new Set<SkipSegment['type']>();
	for (const e of candidates) for (const s of partsOf(e, e.baseDuration ?? 0)) if (s.mixed) kinds.add(s.type);
	return [...kinds];
}

function partsOf(match: Episode, duration: number): SkipSegment[] {

	const stamps = [...match.timestamps].sort((a, b) => a.at - b.at);
	const segments: SkipSegment[] = [];
	stamps.forEach((stamp, i) => {
		const type = kindOf(stamp.type?.name ?? '');
		if (!type || segments.some((s) => s.type === type)) return;
		const end = stamps[i + 1]?.at ?? match.baseDuration ?? duration;
		// "Mixed Credits": the story goes on over the ending song (Re:Zero S2E16).
		if (end - stamp.at >= 5) segments.push({ type, start: stamp.at, end, ...(/mixed/i.test(stamp.type?.name ?? '') ? { mixed: true } : {}) });
	});
	return segments;
}
