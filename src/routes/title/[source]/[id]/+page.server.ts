import { fetchDetails } from '$lib/server/metadata/details';
import { anilistResting } from '$lib/server/metadata/anilistNodes';
import { isAvailable } from '$lib/server/availability';
import { fetchScores, omdbConfigured } from '$lib/server/metadata/omdb';
import { entryIdForSource, entryIdForShow, entryIdByTitle } from '$lib/server/db/queries';
import { showRoots } from '$lib/server/metadata/franchise';
import { knownPeople } from '$lib/server/db/people';
import { addFromSource } from '$lib/server/entries';
import { safeBack } from '$lib/back';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

/**
 * A title you don't own yet.
 *
 * Reached from an actor's "also known for" list, so you can read what something
 * is about before deciding to add it. Anything already in the library is sent
 * to its own entry page instead — there's no reason to look at a preview of
 * something you've already got.
 */
export const load: PageServerLoad = async ({ params, url }) => {
	const { source, id } = params;

	if (source !== 'tmdb' && source !== 'anilist') error(404, 'Unknown source.');

	let ownedEntryId = entryIdForSource(source, id);
	// Owning any season of the show counts as owning this one.
	if (!ownedEntryId && source === 'anilist') {
		const root = (await showRoots([Number(id)])).get(Number(id));
		if (root) ownedEntryId = entryIdForShow(root);
	}

	let details = await fetchDetails(source, id);
	// A hiccup gets one more try; AniList asking Catalog to slow down isn't "nothing found".
	if (!details.title && !anilistResting()) details = await fetchDetails(source, id);
	if (!details.title && source === 'anilist' && anilistResting()) error(503, 'AniList is busy. Try again in a few seconds.');
	if (!details.title) error(404, 'Nothing found for that.');
	// The same show added from the other site (AniList's Re:Zero, TMDB's in the library).
	ownedEntryId ??= entryIdByTitle(details.title, details.year) ?? (details.altTitle ? entryIdByTitle(details.altTitle, details.year) : null);

	// A film plays as a film, wherever it's listed: an anime film is under Anime (Re:Zero's
	// Memory Snow), and played as a series it opened the show instead.
	const film =
		details.categorySlug === 'movies' ||
		(source === 'tmdb' && id.startsWith('movie:')) ||
		details.kind === 'Movie' ||
		(details.kind === 'OVA' && details.episodesTotal === 1);
	const watchType = film ? 'movie' : 'tv';

	// Started now, so the Watch button's own check (sent once the page shows) finds it under way.
	if (!details.unreleased) {
		isAvailable(details.title, watchType, details.year ? String(details.year) : '').catch(() => {});
	}

	// Anyone in the cast you've already seen elsewhere gets a link.
	const known = knownPeople(details.cast.map((person) => person.sourceId));
	const cast = details.cast.map((person) => ({
		...person,
		entryPersonId: known.get(person.sourceId) ?? null
	}));

	const scores = omdbConfigured()
		? ((await fetchScores({
				imdbId: details.imdbId,
				title: details.title,
				year: details.year,
				isSeries: details.categorySlug === 'tv'
			})) ?? null)
		: null;

	return {
		source,
		sourceId: id,
		details: { ...details, cast: [] },
		cast,
		scores,
		ownedEntryId: ownedEntryId ?? null,
		watchType,
		// Set when you arrived from somewhere in the app, so "back" returns there.
		back: safeBack(url.searchParams.get('back'))
	};
};

export const actions: Actions = {
	add: async ({ params, request, url }) => {
		const { source, id } = params;

		const form = await request.formData();
		const added = await addFromSource(source, id, String(form.get('status') ?? 'planned'));

		if (!added) error(404, 'Nothing found for that.');

		// Keep the way back (to a watch order, say) after adding.
		const back = safeBack(url.searchParams.get('back'));
		redirect(303, back ? `/entry/${added.id}?back=${encodeURIComponent(back)}` : `/entry/${added.id}`);
	}
};
