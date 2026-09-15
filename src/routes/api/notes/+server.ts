import { json, error } from '@sveltejs/kit';
import { createNote, updateNote, deleteNote, getNote } from '$lib/server/db/notes';
import { sanitizeHtml, sanitizeTitle } from '$lib/server/sanitize';
import type { RequestHandler } from './$types';

/** Create a blank page. */
export const PUT: RequestHandler = async () => json({ id: createNote() });

/** Save a page. Called as you type, so it has to be cheap and forgiving. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { id?: number; title?: string; body?: string };

	if (!body.id || !getNote(body.id)) error(404, 'That page does not exist.');

	updateNote(body.id, sanitizeTitle(body.title ?? '') || 'Untitled', sanitizeHtml(body.body ?? ''));
	return json({ ok: true, savedAt: new Date().toISOString() });
};

export const DELETE: RequestHandler = async ({ request }) => {
	const { id } = (await request.json()) as { id?: number };
	if (!id) error(400, 'Need a page to delete.');

	deleteNote(id);
	return json({ ok: true });
};
