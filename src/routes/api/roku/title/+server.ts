import { error, json } from '@sveltejs/kit';
import { progressMatches } from '$lib/release';
import { ambiguousRelease } from '$lib/server/seriesIdentity';
import { playsAsFilm } from '$lib/watchType';
import { fetchDetails } from '$lib/server/metadata/details';
import { continueWatchingList, entryIdForSource, getEntry, profileTitleFor } from '$lib/server/db/queries';
import { currentProfile, MAIN_PROFILE } from '$lib/server/profile';
import { keptPlayerList, showSeasons } from '$lib/server/tvEpisodes';
import { seasonsWord } from '$lib/seasonsWord';
import { bigPicture } from '$lib/tv/tiles';
import type { RequestHandler } from './$types';

/**
 * One title for the Roku (?source=tmdb|anilist&id=…), as on the TV's title screen: what it is,
 * the name it plays under, where it was left, and a show's seasons (their episodes come from
 * /api/tv/season, as on the TV).
 */
export const GET: RequestHandler = async ({ url }) => {
	const source = url.searchParams.get('source') ?? '';
	const id = url.searchParams.get('id') ?? '';
	if (source !== 'tmdb' && source !== 'anilist') return error(400, 'Which title?');

	const details = await fetchDetails(source, id);
	if (!details.title) return error(404, 'Nothing found for that.');
	const mine = currentProfile() === MAIN_PROFILE;
	const ownedId = mine ? entryIdForSource(source, id) : null;
	const entry = mine ? (ownedId ? getEntry(ownedId) : null) : profileTitleFor(source, id, details.title, details.year);

	const film = playsAsFilm({ categorySlug: details.categorySlug, sourceId: id, kind: details.kind, episodesTotal: details.episodesTotal });
	const type = film ? 'movie' : 'tv';
	const names = [details.title, entry?.title, details.altTitle].filter(Boolean).map((n) => n!.toLowerCase());
	const dated = await ambiguousRelease(details.title, type, String(details.year ?? ''));
	const continuing = continueWatchingList().find((item) => item.type === type && progressMatches(item.title, names, details.year, dated)) ?? null;
	const all = type === 'tv' ? await showSeasons(source, id, entry?.title ?? details.title).catch(() => null) : null;
	// Not Specials on the Roku yet: its app would call them "Season 0" (roku/components/TitleScreen.brs).
	const show = all ? { ...all, seasons: all.seasons.filter((s) => s.number > 0) } : null;
	let season = continuing?.season ?? -1;
	if (show && !show.seasons.some((s) => s.number === season)) season = show.seasons[0]?.number ?? 0;
	// The player's own seasons from last time (Bleach's 18, not TMDB's 2), for the line under the name.
	const playTitle = entry?.title ?? details.title;
	const kept = show ? keptPlayerList(playTitle, String(details.year ?? ''))?.list : null;

	return json({
		title: details.title,
		playTitle,
		year: details.year,
		type,
		overview: details.overview ?? '',
		poster: details.posterUrl,
		backdrop: details.backdropUrl,
		rating: details.externalRating ?? null,
		runtime: details.runtimeMinutes ?? null,
		unreleased: details.unreleased ?? false,
		showId: show?.showId ?? null,
		seasons: show?.seasons.map((s) => ({ number: s.number, name: s.name, count: s.count })) ?? [],
		season,
		big: bigPicture(details.posterUrl),
		// What the Fire TV's title screen says under the name: "2024 · TV · 2 seasons · ★ 8.4".
		facts: [
			details.year,
			details.kind,
			seasonsWord(details.seasons, kept?.seasons),
			details.runtimeMinutes && type === 'movie' ? `${Math.floor(details.runtimeMinutes / 60)}h ${details.runtimeMinutes % 60}m`.replace(/^0h /, '') : null,
			details.externalRating ? `★ ${details.externalRating.toFixed(1)}` : null
		]
			.filter(Boolean)
			.join(' · '),
		entryId: entry?.id ?? null,
		// The Play button's words, as on the Fire TV.
		playLabel: continuing
			? type === 'tv' && continuing.season
				? continuing.newEpisode
					? `Play new episode S${continuing.season}E${continuing.episode}`
					: `Resume S${continuing.season}E${continuing.episode}`
				: 'Resume'
			: 'Play',
		// The year goes with it only when it isn't being picked up where it was left (as on the Fire TV).
		playYear: continuing ? '' : String(details.year ?? ''),
		source,
		id,
		inList: Boolean(entry),
		continuing: continuing
			? {
					season: continuing.season,
					episode: continuing.episode,
					progress: continuing.duration > 0 ? continuing.currentTime / continuing.duration : 0,
					left: continuing.duration > 0 ? Math.round((continuing.duration - continuing.currentTime) / 60) : null
				}
			: null
	});
};
