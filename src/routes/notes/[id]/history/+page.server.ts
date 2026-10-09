import { getNote, listVersions } from '$lib/server/db/notes';
import { notesToken } from '$lib/server/settings';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, cookies }) => {
	const note = getNote(Number(params.id));
	if (!note) error(404, 'That page does not exist.');

	// A locked page's history is as private as the page: the PIN is asked for there first.
	const token = cookies.get('catalog_notes');
	if (note.locked && !(token && token === notesToken())) redirect(303, `/notes/${note.id}`);

	return { note, versions: listVersions(note.id) };
};
