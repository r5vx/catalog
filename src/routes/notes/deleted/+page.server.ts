import { listDeletedNotes, countNotes, eraseExpiredNotes, listNoteTags, KEEP_DELETED_DAYS } from '$lib/server/db/notes';
import { libraryHeaderData } from '$lib/server/libraryHeader';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	eraseExpiredNotes();
	return {
		...libraryHeaderData(),
		deleted: listDeletedNotes(),
		pageCount: countNotes(),
		tags: listNoteTags(),
		keepDays: KEEP_DELETED_DAYS
	};
};
