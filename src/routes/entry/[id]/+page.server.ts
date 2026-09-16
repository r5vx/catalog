import {
	listCategories,
	getEntry,
	updateEntry,
	deleteEntry,
	saveOverview,
	saveFacts,
	clearScoreStamp
} from '$lib/server/db/queries';
import { castForEntry, setCast } from '$lib/server/db/people';
import { tagsForEntry, setTags } from '$lib/server/db/tags';
import { fetchDetails } from '$lib/server/metadata/details';
import { omdbConfigured } from '$lib/server/metadata/omdb';
import { parseEntryForm } from '$lib/server/form';
import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const entry = getEntry(Number(params.id));
	if (!entry) error(404, 'That entry does not exist.');

	return {
		entry,
		categories: listCategories(),
		cast: castForEntry(entry.id),
		tags: tagsForEntry(entry.id),
		// The page only offers to look up outside scores when it can.
		scoresAvailable: omdbConfigured()
	};
};

export const actions: Actions = {
	save: async ({ request, params }) => {
		const form = await request.formData();
		const { error: problem, values } = parseEntryForm(form);

		if (problem) return fail(400, { error: problem });

		updateEntry(Number(params.id), values);
		return { saved: true };
	},

	/**
	 * Fetch everything again from TMDB or AniList.
	 *
	 * Worth having when what the databases return changes — series cast used to
	 * come back four people deep, so anything added before that fix still has a
	 * short cast list until it's asked again.
	 */
	refresh: async ({ params }) => {
		const entry = getEntry(Number(params.id));
		if (!entry) error(404, 'That entry does not exist.');

		if (!entry.sourceId) {
			return fail(400, { error: 'Nothing to refresh — this one was added by hand.' });
		}

		const details = await fetchDetails(entry.source, entry.sourceId);

		if (!details.title) {
			return fail(400, { error: 'Could not reach the database. Try again in a minute.' });
		}

		if (details.overview) saveOverview(entry.id, details.overview);
		if (details.tags.length > 0) setTags(entry.id, details.tags);
		if (details.cast.length > 0) setCast(entry.id, details.cast);

		saveFacts(entry.id, {
			runtimeMinutes: details.runtimeMinutes,
			episodesTotal: details.episodesTotal
		});

		// The scores get looked up again when the page reloads.
		clearScoreStamp(entry.id);

		return { refreshed: details.cast.length };
	},

	delete: async ({ params }) => {
		deleteEntry(Number(params.id));
		redirect(303, '/');
	}
};
