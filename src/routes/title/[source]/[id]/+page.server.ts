import { fetchDetails } from '$lib/server/metadata/details';
import { fetchScores, omdbConfigured } from '$lib/server/metadata/omdb';
import { entryIdForSource, categoryIdForSlug } from '$lib/server/db/queries';
import { knownPeople } from '$lib/server/db/people';
import { createFromResult } from '$lib/server/entries';
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

	const owned = entryIdForSource(source, id);
	if (owned) redirect(303, `/entry/${owned}`);

	const details = await fetchDetails(source, id);
	if (!details.title) error(404, 'Nothing found for that.');

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
		// Set when you arrived from an actor's page, so "back" returns there.
		from: Number(url.searchParams.get('from')) || null
	};
};

export const actions: Actions = {
	add: async ({ params, request }) => {
		const { source, id } = params;
		if (source !== 'tmdb' && source !== 'anilist') error(400, 'Unknown source.');

		const existing = entryIdForSource(source, id);
		if (existing) redirect(303, `/entry/${existing}`);

		const form = await request.formData();
		const details = await fetchDetails(source, id);
		if (!details.title) error(404, 'Nothing found for that.');

		const status = String(form.get('status') ?? 'planned');

		const entryId = createFromResult(
			{
				key: `${source}:${id}`,
				source,
				sourceId: id,
				title: details.title,
				altTitle: details.altTitle,
				year: details.year,
				posterUrl: details.posterUrl,
				overview: details.overview,
				categorySlug: details.categorySlug,
				confident: true,
				kind: details.kind,
				episodesTotal: details.episodesTotal,
				runtimeMinutes: details.runtimeMinutes,
				externalRating: details.externalRating,
				externalVotes: details.externalVotes,
				popularity: 0
			},
			{
				categoryId: categoryIdForSlug(details.categorySlug),
				status,
				// Something you've just discovered goes on the list, not into
				// history — unless you say you've already seen it.
				markWatchedToday: status === 'completed'
			}
		);

		redirect(303, `/entry/${entryId}`);
	}
};
