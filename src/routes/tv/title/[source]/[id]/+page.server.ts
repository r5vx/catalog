import { progressMatches } from '$lib/release';
import { ambiguousRelease } from '$lib/server/seriesIdentity';
import { playsAsFilm } from '$lib/watchType';
import { error } from '@sveltejs/kit';
import { fetchDetails } from '$lib/server/metadata/details';
import { anilistResting } from '$lib/server/metadata/anilistNodes';
import { entryIdForSource, entryIdForShow, entryIdByTitle, getEntry, continueWatchingList, profileTitleFor } from '$lib/server/db/queries';
import { currentProfile, MAIN_PROFILE } from '$lib/server/profile';
import { showRoots } from '$lib/server/metadata/franchise';
import { keptPlayerList, showSeasons } from '$lib/server/tvEpisodes';
import { startMoreLikeThis } from '$lib/server/recommendations';
import type { PageServerLoad } from './$types';

/**
 * One title on the TV: its picture, what it's about, and Play (or Resume, where you left off).
 * Whether it's in the library decides the My List button.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { source, id } = params;
	if (source !== 'tmdb' && source !== 'anilist') error(404, 'Nothing here.');
	// "More like this" starts now, while the page's own details load.
	startMoreLikeThis(source, id);

	const mine = currentProfile() === MAIN_PROFILE;
	let ownedId = mine ? entryIdForSource(source, id) : null;
	if (mine && !ownedId && source === 'anilist') {
		const root = (await showRoots([Number(id)]).catch(() => new Map<number, number>())).get(Number(id));
		if (root) ownedId = entryIdForShow(root);
	}

	let details = await fetchDetails(source, id);
	if (!details.title && !anilistResting()) details = await fetchDetails(source, id);
	if (!details.title) error(anilistResting() ? 503 : 404, anilistResting() ? 'AniList is busy. Try again in a few seconds.' : 'Nothing found for that.');
	if (mine) ownedId ??= entryIdByTitle(details.title, details.year) ?? (details.altTitle ? entryIdByTitle(details.altTitle, details.year) : null);
	// Someone else's profile: whether it's on their own list.
	const entry = mine ? (ownedId ? getEntry(ownedId) : null) : profileTitleFor(source, id, details.title, details.year);

	// A film plays as a film wherever it's listed (anime films are under Anime).
	const film = playsAsFilm({ categorySlug: details.categorySlug, sourceId: id, kind: details.kind, episodesTotal: details.episodesTotal });
	const type = film ? 'movie' : 'tv';

	// Where it was left: Continue Watching, under its name here or its name in the library.
	const names = [details.title, entry?.title, details.altTitle].filter(Boolean).map((n) => n!.toLowerCase());
	const dated = await ambiguousRelease(details.title, type, String(details.year ?? ''));
	const continuing = continueWatchingList().find((item) => item.type === type && progressMatches(item.title, names, details.year, dated)) ?? null;

	// A show's seasons, for picking an episode before playing. Opens on the season being
	// watched; an anime season's own entry on the season that came out that year.
	const show = type === 'tv' ? await showSeasons(source, id, entry?.title ?? details.title).catch(() => null) : null;
	// (-1 when nothing's being watched: 0 is Specials now, and the page opened on them, 2026-11-15.)
	let season = continuing?.season ?? -1;
	if (show && !show.seasons.some((s) => s.number === season)) {
		const sameYear = source === 'anilist' ? show.seasons.find((s) => s.year === details.year)?.number : 0;
		season = sameYear || show.seasons[0]?.number || 0;
	}

	// The player's own list from last time (all of Bleach's 18 seasons), so it's there at once.
	const playTitle = entry?.title ?? details.title;
	const keptList = show ? (keptPlayerList(playTitle, String(details.year ?? ''))?.list ?? null) : null;

	return {
		source,
		id,
		type,
		progressTitle: dated ? `${playTitle} (${details.year})` : playTitle,
		show: show && show.seasons.length ? { ...show, season } : null,
		keptList,
		details: {
			title: details.title,
			year: details.year,
			overview: details.overview,
			imdbId: details.imdbId,
			posterUrl: details.posterUrl,
			backdropUrl: details.backdropUrl,
			kind: details.kind,
			runtimeMinutes: details.runtimeMinutes,
			seasons: details.seasons,
			externalRating: details.externalRating,
			unreleased: details.unreleased ?? false
		},
		entry: entry ? { id: entry.id, title: entry.title, status: entry.status } : null,
		continuing: continuing
			? {
					title: continuing.title,
					season: continuing.season,
					episode: continuing.episode,
					left: continuing.duration > 0 ? Math.round((continuing.duration - continuing.currentTime) / 60) : null,
					progress: continuing.duration > 0 ? continuing.currentTime / continuing.duration : 0,
					newEpisode: continuing.newEpisode
				}
			: null
	};
};

