import { json } from '@sveltejs/kit';
import { tmdbShow } from '$lib/server/combinedEpisodes';
import { aniwaveExtra } from '$lib/server/sources';
import { parseAniwaveShareKey } from '$lib/server/sources/aniwave';
import { tmdbGet } from '$lib/server/metadata/tmdb';
import { normalizeTitle } from '$lib/server/metadata/types';
import { entryIdForSource, entryIdByTitle, markEntryCompleted } from '$lib/server/db/queries';
import { addFromSource } from '$lib/server/entries';
import { currentProfile, MAIN_PROFILE } from '$lib/server/profile';
import { profileTitleFor, completeProfileTitle } from '$lib/server/db/queries';
import { addProfileTitleFromSource } from '$lib/server/profileTitles';
import type { RequestHandler } from './$types';

/**
 * A show's film watched to the end from its Specials tab (Re:Zero's Memory Snow), with Autosync
 * on: the film itself is marked completed in the library, or added as completed.
 * Body: { title (the show's), year, ref (the film's Aniwave share key) }.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { title, year, ref } = await request.json().catch(() => ({}));
	const share = parseAniwaveShareKey(String(ref ?? ''));
	if (!title || !share) return json({ ok: false });

	const show = await tmdbShow(String(title), String(year ?? ''));
	const extra = show ? await aniwaveExtra(show, String(title), share.id) : null;
	if (!extra?.film) return json({ ok: false });

	// The film on TMDB: the one named exactly that, else the top animated one.
	type Found = { results: { id: number; title: string; release_date?: string; genre_ids?: number[] }[] };
	const found = await tmdbGet<Found>('/search/movie', { query: extra.name });
	const film =
		found?.results.find((r) => normalizeTitle(r.title) === normalizeTitle(extra.name)) ??
		found?.results.find((r) => (r.genre_ids ?? []).includes(16));
	if (!film) return json({ ok: false });

	const sourceId = `movie:${film.id}`;

	// Someone else's profile on the TV: on their own list instead.
	if (currentProfile() !== MAIN_PROFILE) {
		const year = Number(film.release_date?.slice(0, 4)) || null;
		const theirs = profileTitleFor('tmdb', sourceId, film.title, year);
		if (theirs) {
			completeProfileTitle(theirs.id);
			return json({ ok: true, id: theirs.id });
		}
		const id = await addProfileTitleFromSource('tmdb', sourceId, 'completed');
		return json({ ok: Boolean(id), id });
	}
	const owned = entryIdForSource('tmdb', sourceId) ?? entryIdByTitle(film.title, film.release_date?.slice(0, 4));
	if (owned) {
		markEntryCompleted(owned);
		return json({ ok: true, id: owned });
	}
	const added = await addFromSource('tmdb', sourceId, 'completed');
	return json({ ok: Boolean(added), id: added?.id ?? null });
};
