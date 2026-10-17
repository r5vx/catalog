import { tmdbGet } from './metadata/tmdb';
import { tmdbShow } from './combinedEpisodes';
import { getOrderCache, saveOrderCache } from './db/queries';

/**
 * A show's seasons and episodes for the TV's title screen, from TMDB — the same numbering the
 * player's episode list uses, so picking one there opens that episode. Nothing here asks
 * Showbox, so looking through shows costs it nothing.
 */

export type TvSeason = { number: number; name: string; count: number; year: number | null };

const yearOf = (date: string | null | undefined) => Number(date?.slice(0, 4)) || null;
export type TvEpisode = {
	episode: number;
	name: string;
	still: string | null;
	airDate: string | null;
	runtime: number | null;
	overview: string | null;
};

const DAY = 24 * 60 * 60 * 1000;

function saved<T>(key: string, maxAge: number): T | undefined {
	const hit = getOrderCache(key);
	return hit && Date.now() - hit.at < maxAge ? (hit.value as T) : undefined;
}

/** The show on TMDB and its seasons (not Specials). For a TMDB title its id; for anime, by name. */
export async function showSeasons(source: string, id: string, title: string): Promise<{ showId: number; seasons: TvSeason[] } | null> {
	if (source === 'tmdb') {
		const showId = Number(id.replace(/^tv:/, ''));
		if (!id.startsWith('tv:') || !showId) return null;
		const key = `tv-seasons2|${showId}`;
		let seasons = saved<TvSeason[]>(key, DAY);
		if (!seasons) {
			type Details = { seasons?: { season_number: number; name: string; episode_count: number; air_date?: string | null }[] };
			const details = await tmdbGet<Details>(`/tv/${showId}`);
			if (!details) return null;
			seasons = (details.seasons ?? []).map((s) => ({ number: s.season_number, name: s.name, count: s.episode_count, year: yearOf(s.air_date) }));
			saveOrderCache(key, seasons, Date.now());
		}
		return { showId, seasons: seasons.filter((s) => s.number > 0 && s.count > 0) };
	}
	const show = await tmdbShow(title, '').catch(() => null);
	if (!show) return null;
	return {
		showId: show.id,
		seasons: show.seasons
			.filter((s) => s.number > 0 && s.count > 0)
			.map((s) => ({ number: s.number, name: s.name, count: s.count, year: yearOf(s.airDate) }))
	};
}

/** One season's episodes, with their pictures. */
export async function seasonEpisodes(showId: number, season: number): Promise<TvEpisode[]> {
	const key = `tv-season|${showId}|${season}`;
	const known = saved<TvEpisode[]>(key, DAY);
	if (known) return known;
	type Episode = {
		episode_number: number;
		name: string;
		still_path: string | null;
		air_date: string | null;
		runtime: number | null;
		overview: string | null;
	};
	const data = await tmdbGet<{ episodes?: Episode[] }>(`/tv/${showId}/season/${season}`);
	if (!data) return [];
	const episodes = (data.episodes ?? []).map((e) => ({
		episode: e.episode_number,
		name: e.name,
		still: e.still_path ? `https://image.tmdb.org/t/p/w300${e.still_path}` : null,
		airDate: e.air_date,
		runtime: e.runtime,
		overview: e.overview || null
	}));
	saveOrderCache(key, episodes, Date.now());
	return episodes;
}

/* ------------------------------------------------ the player's own list, kept */

/** A show's episode list as the player numbers it, for the TV's title page (/api/tv/player-episodes). */
export type PlayerList = {
	title: string;
	retryIn?: number;
	seasons: { number: number; count: number }[];
	episodes: { season: number; episode: number; available: boolean; airDate: string | null }[];
};

/** A complete list is kept this long (looked up again in the background each visit). */
const PLAYER_LIST_KEPT = 60 * 24 * 60 * 60 * 1000;

const playerListKey = (title: string, year: string) => `tv-episodes|${title.toLowerCase()}|${year}`;

export function keptPlayerList(title: string, year: string): { list: PlayerList; at: number } | null {
	const kept = getOrderCache(playerListKey(title, year));
	return kept && Date.now() - kept.at < PLAYER_LIST_KEPT ? { list: kept.value as PlayerList, at: kept.at } : null;
}

export function keepPlayerList(title: string, year: string, list: PlayerList): void {
	saveOrderCache(playerListKey(title, year), list, Date.now());
}

