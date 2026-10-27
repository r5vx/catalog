/**
 * Whether a show is still going (more episodes to come), for the player's end-of-show step: the
 * last episode out finished makes it Caught up rather than Completed. By TMDB's status for the
 * show ("Returning Series", "In Production"…) or a next episode it lists; anime too, as TMDB has
 * it (found by name, like the TV's title screens). Not known (can't ask): not going, so it's
 * Completed as before.
 */
import { tmdbShow } from './combinedEpisodes';
import { tmdbGet } from './metadata/tmdb';

const GOING = new Set(['Returning Series', 'In Production', 'Planned', 'Pilot']);

export async function showStillAiring(title: string, year: string): Promise<boolean> {
	const show = (await tmdbShow(title, year).catch(() => null)) ?? (year ? await tmdbShow(title, '').catch(() => null) : null);
	if (!show) return false;
	const details = await tmdbGet<{ status?: string; next_episode_to_air?: unknown }>(`/tv/${show.id}`).catch(() => null);
	return Boolean(details && (GOING.has(details.status ?? '') || details.next_episode_to_air));
}
