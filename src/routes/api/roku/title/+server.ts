import { error, json } from '@sveltejs/kit';
import { playsAsFilm } from '$lib/watchType';
import { fetchDetails } from '$lib/server/metadata/details';
import { continueWatchingList, entryIdForSource, getEntry, profileTitleFor } from '$lib/server/db/queries';
import { currentProfile, MAIN_PROFILE } from '$lib/server/profile';
import { showSeasons } from '$lib/server/tvEpisodes';
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
	const continuing = continueWatchingList().find((item) => item.type === type && names.includes(item.title.toLowerCase())) ?? null;
	const show = type === 'tv' ? await showSeasons(source, id, entry?.title ?? details.title).catch(() => null) : null;
	let season = continuing?.season ?? 0;
	if (show && !show.seasons.some((s) => s.number === season)) season = show.seasons[0]?.number ?? 0;

	return json({
		title: details.title,
		playTitle: continuing?.title ?? entry?.title ?? details.title,
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
			details.seasons ? `${details.seasons} season${details.seasons === 1 ? '' : 's'}` : null,
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
