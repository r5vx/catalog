import {
	listCategories,
	getEntry,
	updateEntry,
	updateEntrySource,
	deleteEntry,
	saveOverview,
	saveFacts,
	clearScoreStamp
} from '$lib/server/db/queries';
import { castForEntry, setCast } from '$lib/server/db/people';
import { tagsForEntry, setTags } from '$lib/server/db/tags';
import { fetchDetails } from '$lib/server/metadata/details';
import { searchAll } from '$lib/server/metadata';
import { omdbConfigured } from '$lib/server/metadata/omdb';
import { parseEntryForm } from '$lib/server/form';
import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

const verifiedSources = new Set<number>();

async function verifySource(entry: { id: number; title: string; source: string; sourceId: string | null }) {
	if (!entry.sourceId || verifiedSources.has(entry.id)) return;
	verifiedSources.add(entry.id);
	try {
		const details = await fetchDetails(entry.source, entry.sourceId);
		if (!details.title || details.title.toLowerCase() === entry.title.toLowerCase()) return;
		const results = await searchAll(entry.title);
		const match = results.find(r => r.title.toLowerCase() === entry.title.toLowerCase());
		if (!match?.sourceId || match.sourceId === entry.sourceId) return;
		updateEntrySource(entry.id, match.source, match.sourceId);
		const correct = await fetchDetails(match.source, match.sourceId);
		if (correct.cast.length > 0) setCast(entry.id, correct.cast);
		if (correct.tags.length > 0) setTags(entry.id, correct.tags);
		if (correct.overview) saveOverview(entry.id, correct.overview);
	} catch {}
}

export const load: PageServerLoad = async ({ params }) => {
	const entry = getEntry(Number(params.id));
	if (!entry) error(404, 'That entry does not exist.');

	await verifySource(entry);

	return {
		entry,
		categories: listCategories(),
		cast: castForEntry(entry.id),
		tags: tagsForEntry(entry.id),
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

		let details = await fetchDetails(entry.source, entry.sourceId);

		// If the stored sourceId points to a different title, re-search and
		// pick the correct one. This fixes entries that were added with a
		// wrong TMDB match.
		if (details.title && details.title.toLowerCase() !== entry.title.toLowerCase()) {
			const results = await searchAll(entry.title);
			const match = results.find(r =>
				r.title.toLowerCase() === entry.title.toLowerCase()
			);
			if (match?.sourceId) {
				updateEntrySource(entry.id, match.source, match.sourceId);
				details = await fetchDetails(match.source, match.sourceId);
			}
		}

		if (!details.title) {
			return fail(400, { error: 'Could not reach the database. Try again in a minute.' });
		}

		if (details.overview) saveOverview(entry.id, details.overview);
		if (details.tags.length > 0) setTags(entry.id, details.tags);
		if (details.cast.length > 0) setCast(entry.id, details.cast);

		saveFacts(entry.id, {
			runtimeMinutes: details.runtimeMinutes,
			episodesTotal: details.episodesTotal,
			checked: true
		});

		clearScoreStamp(entry.id);

		return { refreshed: details.cast.length };
	},

	delete: async ({ params }) => {
		deleteEntry(Number(params.id));
		redirect(303, '/');
	}
};
