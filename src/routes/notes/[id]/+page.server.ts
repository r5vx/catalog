import { getNote } from '$lib/server/db/notes';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const note = getNote(Number(params.id));
	if (!note) error(404, 'That page does not exist.');

	return { note };
};
