import { listNotes, createNote, countNotes } from '$lib/server/db/notes';
import { listCategories, countsByCategory } from '$lib/server/db/queries';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async () => {
	const countByCategory = countsByCategory();

	return {
		notes: listNotes(),
		categories: listCategories(),
		countByCategory,
		total: Object.values(countByCategory).reduce((sum, n) => sum + n, 0),
		noteCount: countNotes()
	};
};

export const actions: Actions = {
	create: async () => {
		redirect(303, `/notes/${createNote()}`);
	}
};
