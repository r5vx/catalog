import { json, error } from '@sveltejs/kit';
import { continueWatchingList } from '$lib/server/db/queries';
import { keptPlayerList, showSeasons } from '$lib/server/tvEpisodes';
import type { RequestHandler } from './$types';

/**
 * A show's seasons for the computer's episode list (src/lib/EpisodePicker.svelte), worked out
 * as the TV's title page does: opens on the season being watched (an anime season's own entry
 * on the season that came out that year), with the player's own list from last time.
 * ?source=tmdb|anilist&id=<its id>&title=<the name it plays under>&year=<its year>&alt=<other name>
 */
export const GET: RequestHandler = async ({ url }) => {
	const source = url.searchParams.get('source') ?? '';
	const id = url.searchParams.get('id') ?? '';
	const title = url.searchParams.get('title') ?? '';
	const year = Number(url.searchParams.get('year')) || null;
	const alt = url.searchParams.get('alt') ?? '';
	if ((source !== 'tmdb' && source !== 'anilist') || !id || !title) error(400, 'Which show?');

	const show = await showSeasons(source, id, title).catch(() => null);
	if (!show?.seasons.length) return json({ show: null });

	// Where it was left: Continue Watching, under either of its names.
	const names = [title, alt].filter(Boolean).map((n) => n.toLowerCase());
	const continuing = continueWatchingList().find((item) => item.type === 'tv' && names.includes(item.title.toLowerCase())) ?? null;

	let season = continuing?.season ?? 0;
	if (!show.seasons.some((s) => s.number === season)) {
		const sameYear = source === 'anilist' ? show.seasons.find((s) => s.year === year)?.number : 0;
		season = sameYear || show.seasons[0].number;
	}

	const playTitle = continuing?.title ?? title;
	// Asked with no year once it's being watched, as the player was then (the TV page does the same).
	const playYear = continuing ? '' : String(year ?? '');
	return json({
		show: { ...show, season },
		playTitle,
		playYear,
		keptList: keptPlayerList(playTitle, playYear)?.list ?? null,
		continuing: continuing ? { season: continuing.season, episode: continuing.episode } : null
	});
};
