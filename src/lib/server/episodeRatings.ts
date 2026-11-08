import { tmdbGet } from './metadata/tmdb';
import { omdbSeason } from './metadata/omdb';
import { showSeasons } from './tvEpisodes';
import { getOrderCache, saveOrderCache } from './db/queries';

/**
 * Every episode's rating, season by season, for the chart on a show's page
 * (src/lib/EpisodeRatings.svelte). IMDb's (through OMDb, one question per season, IMDb's own
 * seasons) where IMDb has the show, else TMDB's own (an episode needs a few votes to count).
 * Kept three days; asked only when the chart is opened. At most 40 seasons (OMDb's free key allows 1,000 questions a day).
 */

export type RatedEpisode = { episode: number; title: string; rating: number | null };
export type RatedSeason = { number: number; episodes: RatedEpisode[] };
export type EpisodeRatings = { from: 'IMDb' | 'TMDB'; seasons: RatedSeason[] };

const KEEP = 3 * 24 * 60 * 60 * 1000;
const MAX_SEASONS = 40;

/** Runs `job` on each item, `width` at a time. */
async function inTurn<T, R>(items: T[], width: number, job: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(width, items.length) }, async () => {
			while (next < items.length) {
				const at = next++;
				out[at] = await job(items[at]);
			}
		})
	);
	return out;
}

async function fromTmdb(showId: number, season: number): Promise<RatedEpisode[]> {
	type Episode = { episode_number: number; name: string; vote_average?: number; vote_count?: number };
	const data = await tmdbGet<{ episodes?: Episode[] }>(`/tv/${showId}/season/${season}`);
	return (data?.episodes ?? []).map((e) => ({
		episode: e.episode_number,
		title: e.name,
		rating: (e.vote_count ?? 0) >= 3 && e.vote_average ? Math.round(e.vote_average * 10) / 10 : null
	}));
}

export async function episodeRatings(source: string, id: string, title: string): Promise<EpisodeRatings | null> {
	const show = await showSeasons(source, id, title).catch(() => null);
	if (!show?.seasons.length) return null;
	const cacheKey = `episode-ratings2|${show.showId}`;
	const kept = getOrderCache(cacheKey);
	if (kept && Date.now() - kept.at < KEEP) return kept.value as EpisodeRatings;

	const seasons = show.seasons.slice(0, MAX_SEASONS).map((s) => s.number);
	const ids = await tmdbGet<{ imdb_id?: string | null }>(`/tv/${show.showId}/external_ids`);
	const imdbId = ids?.imdb_id ?? null;

	let answer: EpisodeRatings | null = null;
	if (imdbId) {
		// IMDb's own seasons (Re:Zero is one long season on TMDB, three on IMDb): season 1 says how many.
		const first = await omdbSeason(imdbId, 1);
		const count = Math.min(MAX_SEASONS, first?.totalSeasons ?? 0);
		const rest = count > 1 ? await inTurn(Array.from({ length: count - 1 }, (_, i) => i + 2), 4, (n) => omdbSeason(imdbId, n)) : [];
		const asked = first ? [first, ...rest] : [];
		// Every season answered (a refusal or the daily limit: TMDB's instead, not kept as IMDb's).
		if (asked.length && asked.every((a) => a !== null) && asked.some((a) => a!.episodes.some((e) => e.rating !== null))) {
			answer = { from: 'IMDb', seasons: asked.map((a, i) => ({ number: i + 1, episodes: a!.episodes })) };
		}
	}
	if (!answer) {
		const asked = await inTurn(seasons, 4, (n) => fromTmdb(show.showId, n));
		answer = { from: 'TMDB', seasons: seasons.map((number, i) => ({ number, episodes: asked[i] })) };
	}
	answer.seasons = answer.seasons.filter((s) => s.episodes.length);
	if (answer.seasons.some((s) => s.episodes.some((e) => e.rating !== null))) saveOrderCache(cacheKey, answer, Date.now());
	return answer;
}
