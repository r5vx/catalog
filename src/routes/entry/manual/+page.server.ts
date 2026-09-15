import { listCategories, insertEntry } from '$lib/server/db/queries';
import { parseEntryForm } from '$lib/server/form';
import { today } from '$lib/server/entries';
import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async () => ({
	categories: listCategories(),
	// You usually add something the day you watch it, so today is pre-filled.
	// Clear the box if that is not true.
	defaults: { finishedOn: today() }
});

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const { error, values } = parseEntryForm(form);

		if (error) return fail(400, { error });

		const id = insertEntry(values);
		redirect(303, `/entry/${id}`);
	}
};
