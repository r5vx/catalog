/**
 * How many episodes each season of a show has, for the "Season reached" and "Episode reached"
 * dropdowns on its page (src/lib/ProgressPicker.svelte). TMDB lists every season with its
 * episode count; an AniList entry is one season, with its episode total. Specials (TMDB's
 * season 0) are left out.
 *
 * Kept in memory for half a day: it's one small TMDB request per show, asked when its page opens.
 */
import { tmdbGet } from './tmdb';

export type SeasonCount = { season: number; episodes: number };

const kept = new Map<string, { at: number; seasons: SeasonCount[] | null }>();
const KEEP = 12 * 60 * 60 * 1000;

/** The seasons and their episode counts, or null when they can't be known. */
export async function seasonsOf(source: string, sourceId: string | null, episodesTotal: number | null): Promise<SeasonCount[] | null> {
	if (source === 'anilist') return episodesTotal ? [{ season: 1, episodes: episodesTotal }] : null;
	const id = /^tv:(\d+)$/.exec(sourceId ?? '')?.[1];
	if (source !== 'tmdb' || !id) return null;

	const found = kept.get(id);
	if (found && Date.now() - found.at < KEEP) return found.seasons;

	const show = await tmdbGet<{ seasons?: { season_number: number; episode_count: number }[] }>(`/tv/${id}`);
	const seasons = show?.seasons
		? show.seasons
				.filter((s) => s.season_number > 0 && s.episode_count > 0)
				.map((s) => ({ season: s.season_number, episodes: s.episode_count }))
				.sort((a, b) => a.season - b.season)
		: null;
	// (Not kept when TMDB didn't answer: asked again next time.)
	if (show) kept.set(id, { at: Date.now(), seasons: seasons?.length ? seasons : null });
	return seasons?.length ? seasons : null;
}
