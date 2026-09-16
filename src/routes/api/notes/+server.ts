import { json, error } from '@sveltejs/kit';
import { createNote, updateNote, deleteNote, getNote } from '$lib/server/db/notes';
import { sanitizeHtml, sanitizeTitle } from '$lib/server/sanitize';
import { notesToken } from '$lib/server/settings';
import type { RequestHandler } from './$types';

/**
 * A locked page can't be written or deleted without the PIN either.
 *
 * Guarding only the page that displays it would leave the door open here —
 * saving over a locked page is as good as destroying it.
 */
const mayTouch = (locked: boolean, cookie: string | undefined) =>
	!locked || (Boolean(cookie) && cookie === notesToken());

/** Create a blank page. */
export const PUT: RequestHandler = async () => json({ id: createNote() });

/** Save a page. Called as you type, so it has to be cheap and forgiving. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = (await request.json()) as { id?: number; title?: string; body?: string };

	const note = body.id ? getNote(body.id) : null;
	if (!note) error(404, 'That page does not exist.');

	if (!mayTouch(note.locked, cookies.get('catalog_notes'))) {
		error(403, 'That page is locked.');
	}

	updateNote(note.id, sanitizeTitle(body.title ?? '') || 'Untitled', sanitizeHtml(body.body ?? ''));
	return json({ ok: true, savedAt: new Date().toISOString() });
};

export const DELETE: RequestHandler = async ({ request, cookies }) => {
	const { id } = (await request.json()) as { id?: number };
	if (!id) error(400, 'Need a page to delete.');

	const note = getNote(id);
	if (!note) error(404, 'That page does not exist.');

	if (!mayTouch(note.locked, cookies.get('catalog_notes'))) {
		error(403, 'That page is locked.');
	}

	deleteNote(id);
	return json({ ok: true });
};
