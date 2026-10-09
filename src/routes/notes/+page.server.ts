import { listNotes, createNote, countDeletedNotes, eraseExpiredNotes, listNoteTags, setNoteTag, type NotesSort } from '$lib/server/db/notes';
import { readSettings } from '$lib/server/settings';
import { libraryHeaderData } from '$lib/server/libraryHeader';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async () => {
	eraseExpiredNotes();
	const sort = (readSettings().notesSort ?? 'updated') as NotesSort;
	return {
		...libraryHeaderData(),
		notes: listNotes(sort),
		sort,
		tags: listNoteTags(),
		deletedCount: countDeletedNotes()
	};
};

export const actions: Actions = {
	// Made while looking at one tag, a new page gets that tag.
	create: async ({ request }) => {
		const tag = Number((await request.formData()).get('tag'));
		const id = createNote();
		if (tag > 0) setNoteTag(id, tag, true);
		redirect(303, `/notes/${id}`);
	}
};
