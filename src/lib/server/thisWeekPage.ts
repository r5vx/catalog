import { animeThisWeek, newFilms, newShows, weekWindow, yourShows, fromWatchList, type WeekItem, type WeekList } from '$lib/server/thisWeek';
import { existingSourceKeysWithIds, playedFilmTitles, olderLibraryFilmKeys, tvLibrary } from '$lib/server/db/queries';
import { currentProfile, MAIN_PROFILE } from '$lib/server/profile';
import { hasTmdbKey } from '$lib/server/metadata/tmdb';
import { withBack } from '$lib/back';
import { titleHref } from '$lib/tv/tiles';
import { continueWatchingWithPosters } from '$lib/server/continueWatching';
import { tvTitleLink } from '$lib/server/tvLinks';

/** At most `ms` for one list; the page shows the rest either way. */
const within = <T>(work: Promise<T>, ms: number, fallback: T) =>
	Promise.race([work.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms).unref?.())]);

/**
 * This week (src/lib/server/thisWeek.ts). Every list comes in on its own as it's ready (streamed),
 * so the page opens at once; lists are kept for hours, so mostly they're there straight away.
 */
export async function loadThisWeek(tv = false) {
	const owned = currentProfile() === MAIN_PROFILE ? existingSourceKeysWithIds() : {};
	const tmdbReady = hasTmdbKey();
	const played = playedFilmTitles();
	const watchedFilms = tvLibrary().filter((item) => ['completed', 'watching', 'rewatching', 'caught_up'].includes(item.status)
		&& (item.category === 'movies' || item.sourceId?.startsWith('movie:')));
	for (const item of watchedFilms) played.add(item.title.trim().toLowerCase());
	const watched = olderLibraryFilmKeys(weekWindow().startMs);
	for (const item of watchedFilms) if (item.source === 'tmdb') watched.add(`tmdb:${item.sourceId}`);
	const unwatched = (items: WeekItem[] | null) => items?.filter((item) => !item.key.startsWith('tmdb:movie:')
		|| (!watched.has(item.key) && !played.has(item.title.trim().toLowerCase()))) ?? null;
	// One in the library opens its entry ("tmdb:movie:123", "anilist:456").
	const mark = (items: WeekItem[] | null) =>
		(items ?? []).map((i) => {
			const id = owned[i.key.split(':').slice(0, i.key.startsWith('anilist:') ? 2 : 3).join(':')];
			const parts = i.key.split(':');
			const href = tv
				? titleHref(parts[0], parts[0] === 'anilist' ? parts[1] : `${parts[1]}:${parts[2]}`)
				: withBack(id !== undefined ? `/entry/${id}` : i.href, '/new');
			return { ...i, owned: id !== undefined, href };
		});
	const list = async (work: Promise<WeekItem[] | null>) => {
		const items = await within(work, 15_000, null);
		return { items: mark(items), failed: items === null };
	};
	const anime = within<WeekList | null>(animeThisWeek(), 15_000, null).then((result) => ({
		items: mark(result?.items ?? null),
		failed: result === null || result.failed
	}));
	const streaming = list(tmdbReady ? newFilms('4|5').then(unwatched) : Promise.resolve([]));
	const cinemas = list(tmdbReady ? newFilms('2|3') : Promise.resolve([]));
	const shows = list(tmdbReady ? newShows() : Promise.resolve([]));
	const watchList = within<WeekList>(tmdbReady ? fromWatchList() : Promise.resolve({ items: [], failed: false }), 15_000, { items: [], failed: true })
		.then((result) => ({ ...result, items: mark(unwatched(result.items)) }));
	const continueWatching = continueWatchingWithPosters().then(async (items) => Promise.all(items.map(async (item) => ({
		...item,
		link: tv && item.type !== 'replay' ? await tvTitleLink(item.title, item.type).catch(() => null) : null
	}))));
	const yours = (tmdbReady && currentProfile() === MAIN_PROFILE
		? within(yourShows(), 12_000, { out: [], soon: [], failed: true })
		: Promise.resolve({ out: [], soon: [], failed: false })).then((result) => ({
			...result,
			out: mark(result.out),
			soon: mark(result.soon)
		}));
	return {
		week: weekWindow(),
		continueWatching,
		watchList,
		// The library's own shows only on its owner's profile (a phone profile has its own list).
		yours,
		lists: { anime, streaming, cinemas, shows }
	};
}
