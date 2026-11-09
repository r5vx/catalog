import { tmdbGet } from './metadata/tmdb';
import { getOrderCache, saveOrderCache } from './db/queries';

/**
 * Whether a film is anime: Japanese original language and TMDB's Animation genre (a film that
 * merely has a Japanese dub, Avatar, isn't). Null when TMDB didn't answer. Kept a month, shared
 * with /api/watch/is-anime.
 *
 * AniList knowing a title isn't enough: it has an anime called "The Odyssey", so the 2026 film got
 * that anime's subtitles first, and they never matched (2026-11-08).
 */
type Film = { original_language?: string; genre_ids?: number[]; title?: string };

export async function isAnimeFilm(title: string, year: string): Promise<boolean | null> {
	const key = `is-anime|movie|${title.toLowerCase()}|${year}`;
	const kept = getOrderCache(key);
	if (kept && Date.now() - kept.at < 30 * 24 * 60 * 60 * 1000) return kept.value === true;
	const params: Record<string, string> = { query: title };
	if (year) params.year = year;
	const found = await tmdbGet<{ results?: Film[] }>('/search/movie', params).catch(() => null);
	if (!found) return null;
	const want = title.toLowerCase();
	const film = found.results?.find((f) => f.title?.toLowerCase() === want) ?? found.results?.[0];
	const anime = Boolean(film && film.original_language === 'ja' && film.genre_ids?.includes(16));
	saveOrderCache(key, anime, Date.now());
	return anime;
}
