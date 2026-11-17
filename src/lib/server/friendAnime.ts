/**
 * Whether a friend's title is anime, for friends whose Catalog only says "film" or "show" (before
 * 2026-11-17): anything from AniList, or a TMDB show that's Japanese and animated. Asked of TMDB
 * once a title, kept a month. Used by their library's Anime tab and their best rated anime.
 */
import { getOrderCache, saveOrderCache } from './db/queries';
import { tmdbGet } from './metadata/tmdb';

const MONTH = 30 * 24 * 60 * 60 * 1000;

export async function isFriendAnime(key: string): Promise<boolean> {
	if (key.startsWith('anilist:')) return true;
	const m = key.match(/^tmdb:tv:(\d+)$/);
	if (!m) return false;
	const kept = getOrderCache(`friend-anime|${key}`);
	if (kept && Date.now() - kept.at < MONTH) return Boolean(kept.value);
	const show = await tmdbGet<{ original_language?: string; genres?: { id: number }[] }>(`/tv/${m[1]}`).catch(() => null);
	if (!show) return false;
	const anime = show.original_language === 'ja' && Boolean(show.genres?.some((g) => g.id === 16));
	saveOrderCache(`friend-anime|${key}`, anime, Date.now());
	return anime;
}
