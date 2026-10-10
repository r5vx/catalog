import { continueWatchingList, forgetFinishedSubtitles } from './db/queries';
import { tmdbShow } from './combinedEpisodes';

/**
 * Continue Watching, with TMDB's poster for shows that have none (one only another source has,
 * or one Showbox's poster didn't come through for). Saved TMDB answers make this instant after
 * the first time; it never holds the page up more than a second and a half.
 */
export async function continueWatchingWithPosters() {
	// Anything just finished or taken off Continue Watching lets go of its kept subtitles.
	forgetFinishedSubtitles();
	const list = continueWatchingList();
	const missing = list.filter((item) => !item.posterUrl && item.type === 'tv');
	if (!missing.length) return list;
	await Promise.race([
		Promise.all(
			missing.map(async (item) => {
				item.posterUrl = (await tmdbShow(item.title, '').catch(() => null))?.poster ?? null;
			})
		),
		new Promise((resolve) => setTimeout(resolve, 1500))
	]);
	return list;
}
