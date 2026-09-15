import { listCategories, getEntry, updateEntry, deleteEntry } from '$lib/server/db/queries';
import { castForEntry } from '$lib/server/db/people';
import { parseEntryForm } from '$lib/server/form';
import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const entry = getEntry(Number(params.id));
	if (!entry) error(404, 'That entry does not exist.');

	return { entry, categories: listCategories(), cast: castForEntry(entry.id) };
};

export const actions: Actions = {
	save: async ({ request, params }) => {
		const form = await request.formData();
		const { error: problem, values } = parseEntryForm(form);

		if (problem) return fail(400, { error: problem });

		updateEntry(Number(params.id), values);
		return { saved: true };
	},

	delete: async ({ params }) => {
		deleteEntry(Number(params.id));
		redirect(303, '/');
	}
};
