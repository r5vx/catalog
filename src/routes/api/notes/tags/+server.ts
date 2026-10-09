import { json, error } from '@sveltejs/kit';
import { renameNoteTag, deleteNoteTag } from '$lib/server/db/notes';
import { updateSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

/** Rename a notes tag. Body: { id, name }. */
export const PATCH: RequestHandler = async ({ request }) => {
	const { id, name } = (await request.json()) as { id?: number; name?: string };
	const clean = name?.trim().slice(0, 40);
	if (!id || !clean) error(400, 'Need a tag and a name.');
	if (!renameNoteTag(id, clean)) error(409, 'There is already a tag with that name.');
	return json({ ok: true });
};

/** Delete a notes tag. The pages keep everything else. Body: { id }. */
export const DELETE: RequestHandler = async ({ request }) => {
	const { id } = (await request.json()) as { id?: number };
	if (!id) error(400, 'Which tag?');
	deleteNoteTag(id);
	return json({ ok: true });
};

/** Remembers how the notes list is sorted. Body: { sort: 'updated' | 'created' | 'title' }. */
export const POST: RequestHandler = async ({ request }) => {
	const { sort } = (await request.json()) as { sort?: string };
	if (sort !== 'updated' && sort !== 'created' && sort !== 'title') error(400, 'Unknown sort.');
	updateSettings({ notesSort: sort });
	return json({ ok: true });
};
