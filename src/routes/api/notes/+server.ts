import { json, error } from '@sveltejs/kit';
import {
	createNote,
	updateNote,
	deleteNote,
	getNote,
	restoreNote,
	eraseNote,
	restoreVersion,
	setNotePinned,
	setNoteTag,
	noteTagNamed
} from '$lib/server/db/notes';
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

	// Into Recently deleted; it's erased for good after a week, or from there.
	deleteNote(id);
	return json({ ok: true });
};

/**
 * Recently deleted, version history, pinning and tags.
 * Body: { id, action: 'restore' } brings a deleted page back, { id, action: 'erase' } deletes
 * one that's already in Recently deleted for good, { id, action: 'version', versionId } puts
 * an earlier version back. { id, action: 'pin', pinned } and { id, action: 'tag', tagId or
 * tagName (made if new), on } pin and tag it.
 */
export const PATCH: RequestHandler = async ({ request, cookies }) => {
	const { id, action, versionId, pinned, tagId, tagName, on } = (await request.json()) as {
		id?: number;
		action?: string;
		versionId?: number;
		pinned?: boolean;
		tagId?: number;
		tagName?: string;
		on?: boolean;
	};
	const note = id ? getNote(id) : null;
	if (!note) error(404, 'That page does not exist.');

	// Pinning and tagging show nothing of what's written, so they don't need the PIN.
	if (action === 'pin') {
		setNotePinned(note.id, Boolean(pinned));
		return json({ ok: true });
	}
	if (action === 'tag') {
		const name = tagName?.trim().slice(0, 40);
		const tag = name ? noteTagNamed(name) : tagId;
		if (!tag) error(400, 'Which tag?');
		setNoteTag(note.id, tag, on !== false);
		return json({ ok: true, tagId: tag });
	}

	if (!mayTouch(note.locked, cookies.get('catalog_notes'))) {
		error(403, 'That page is locked.');
	}

	if (action === 'restore') restoreNote(note.id);
	else if (action === 'erase') {
		if (!note.deletedAt) error(400, 'Delete it first; it goes to Recently deleted.');
		eraseNote(note.id);
	} else if (action === 'version') {
		if (!versionId || !restoreVersion(note.id, versionId)) error(404, 'That version does not exist.');
	} else error(400, 'Unknown action.');

	return json({ ok: true });
};
