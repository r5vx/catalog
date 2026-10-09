import { db, plainAll, plain } from './index';

export type Note = {
	id: number;
	title: string;
	body: string;
	locked: boolean;
	createdAt: string;
	updatedAt: string;
	/** Set while it's in Recently deleted. */
	deletedAt: string | null;
};

const COLUMNS =
	'id, title, body, locked, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt';

/** How long a deleted note stays in Recently deleted before it's gone for good. */
export const KEEP_DELETED_DAYS = 7;

/**
 * Titles only — the list page doesn't need every note's full contents.
 *
 * A locked note's preview is left empty **in SQL**, so its text never reaches
 * the page at all. Hiding it in the template would still have sent it.
 */
export type NotesSort = 'updated' | 'created' | 'title';

const NOTE_ORDER: Record<NotesSort, string> = {
	updated: 'updated_at DESC',
	created: 'created_at DESC',
	title: 'title COLLATE NOCASE ASC'
};

/** Pinned pages first, then in the order asked for. */
export function listNotes(sort: NotesSort = 'updated') {
	const tags = tagIdsByNote();
	return plainAll<{ id: number; title: string; locked: number; pinned: number; createdAt: string; updatedAt: string; body: string }>(
		db
			.prepare(
				`SELECT id, title, locked, pinned, created_at AS createdAt, updated_at AS updatedAt,
				        CASE WHEN locked = 1 THEN '' ELSE body END AS body
				 FROM notes WHERE deleted_at IS NULL ORDER BY pinned DESC, ${NOTE_ORDER[sort] ?? NOTE_ORDER.updated}`
			)
			.all()
	).map(({ body, ...note }) => ({
		...note,
		locked: Boolean(note.locked),
		pinned: Boolean(note.pinned),
		tagIds: tags.get(note.id) ?? [],
		text: plainText(body)
	}));
}

export function setNotePinned(id: number, pinned: boolean): void {
	db.prepare('UPDATE notes SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
}

/* ------------------------------------------------ tags */

export type NoteTag = { id: number; name: string; count: number };

/** Every tag, A–Z, with how many (not deleted) pages have it. */
export function listNoteTags(): NoteTag[] {
	return plainAll<NoteTag>(
		db
			.prepare(
				`SELECT t.id, t.name, COUNT(n.id) AS count
				 FROM note_tags t
				 LEFT JOIN note_tag_links l ON l.tag_id = t.id
				 LEFT JOIN notes n ON n.id = l.note_id AND n.deleted_at IS NULL
				 GROUP BY t.id ORDER BY t.name COLLATE NOCASE`
			)
			.all()
	);
}

function tagIdsByNote(): Map<number, number[]> {
	const map = new Map<number, number[]>();
	for (const { noteId, tagId } of db.prepare('SELECT note_id AS noteId, tag_id AS tagId FROM note_tag_links').all() as {
		noteId: number;
		tagId: number;
	}[]) {
		map.set(noteId, [...(map.get(noteId) ?? []), tagId]);
	}
	return map;
}

/** The tag with this name, made if it doesn't exist yet. */
export function noteTagNamed(name: string): number {
	db.prepare('INSERT INTO note_tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(name);
	return (db.prepare('SELECT id FROM note_tags WHERE name = ?').get(name) as { id: number }).id;
}

export function setNoteTag(noteId: number, tagId: number, on: boolean): void {
	if (on) db.prepare('INSERT INTO note_tag_links (note_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(noteId, tagId);
	else db.prepare('DELETE FROM note_tag_links WHERE note_id = ? AND tag_id = ?').run(noteId, tagId);
}

/** False when another tag already has that name. */
export function renameNoteTag(id: number, name: string): boolean {
	const clash = db.prepare('SELECT id FROM note_tags WHERE name = ? AND id != ?').get(name, id);
	if (clash) return false;
	db.prepare('UPDATE note_tags SET name = ? WHERE id = ?').run(name, id);
	return true;
}

/** Removes the tag from every page. The pages themselves stay. */
export function deleteNoteTag(id: number): void {
	db.prepare('DELETE FROM note_tag_links WHERE tag_id = ?').run(id);
	db.prepare('DELETE FROM note_tags WHERE id = ?').run(id);
}

/** What's in Recently deleted, newest first. Locked ones show their title only. */
export function listDeletedNotes() {
	return plainAll<{ id: number; title: string; locked: number; deletedAt: string; body: string }>(
		db
			.prepare(
				`SELECT id, title, locked, deleted_at AS deletedAt,
				        CASE WHEN locked = 1 THEN '' ELSE body END AS body
				 FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
			)
			.all()
	).map(({ body, ...note }) => ({ ...note, locked: Boolean(note.locked), text: plainText(body) }));
}

export function countDeletedNotes(): number {
	return (db.prepare('SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NOT NULL').get() as { n: number }).n;
}

/** A note's words without its markup, for the preview line and for search. */
export function plainText(html: string): string {
	return html
		.replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, ' ')
		.replace(/<[^>]*>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();
}

export function countNotes(): number {
	return (db.prepare('SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NULL').get() as { n: number }).n;
}

export function getNote(id: number): Note | null {
	const row = db.prepare(`SELECT ${COLUMNS} FROM notes WHERE id = ?`).get(id);
	if (!row) return null;

	const note = plain<Note>(row);
	return { ...note, locked: Boolean(note.locked) };
}

export function setNoteLocked(id: number, locked: boolean): void {
	db.prepare('UPDATE notes SET locked = ? WHERE id = ?').run(locked ? 1 : 0, id);
}

export function anyNotesLocked(): boolean {
	return Boolean(db.prepare('SELECT 1 FROM notes WHERE locked = 1 LIMIT 1').get());
}

export function createNote(title = 'Untitled'): number {
	const now = new Date().toISOString();
	const result = db
		.prepare('INSERT INTO notes (title, body, created_at, updated_at) VALUES (?, ?, ?, ?)')
		.run(title, '', now, now);

	return Number(result.lastInsertRowid);
}

export function updateNote(id: number, title: string, body: string): void {
	const before = db.prepare('SELECT title, body FROM notes WHERE id = ?').get(id) as { title: string; body: string } | undefined;
	if (before && (before.title !== title || before.body !== body)) keepVersion(id, before, body);

	db.prepare('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?').run(
		title,
		body,
		new Date().toISOString(),
		id
	);
}

/** Into Recently deleted. Nothing is erased yet. */
export function deleteNote(id: number): void {
	db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

export function restoreNote(id: number): void {
	db.prepare('UPDATE notes SET deleted_at = NULL WHERE id = ?').run(id);
}

/** Gone for good, with its history. */
export function eraseNote(id: number): void {
	db.prepare('DELETE FROM note_versions WHERE note_id = ?').run(id);
	db.prepare('DELETE FROM note_tag_links WHERE note_id = ?').run(id);
	db.prepare('DELETE FROM notes WHERE id = ?').run(id);
}

/** Erases whatever has sat in Recently deleted longer than KEEP_DELETED_DAYS. */
export function eraseExpiredNotes(): void {
	const cutoff = new Date(Date.now() - KEEP_DELETED_DAYS * 24 * 60 * 60 * 1000).toISOString();
	const expired = db.prepare('SELECT id FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff) as { id: number }[];
	for (const { id } of expired) eraseNote(id);
}

/* ------------------------------------------------ version history */

export type NoteVersion = { id: number; title: string; body: string; savedAt: string };

/** Versions kept per note; the oldest go first. */
const MAX_VERSIONS = 50;
/** While you keep typing, a version is kept every this often… */
const VERSION_EVERY_MS = 10 * 60 * 1000;

/**
 * Keeps what a note said *before* a save, when it's worth keeping: the first save after a
 * quiet spell, every ten minutes of steady editing, and always when most of the text has
 * just gone (a select-all-and-delete, say).
 */
function keepVersion(id: number, before: { title: string; body: string }, nextBody: string): void {
	const oldText = plainText(before.body);
	if (!oldText && !before.body.includes('<img')) return; // nothing worth keeping

	const last = db
		.prepare('SELECT saved_at AS savedAt FROM note_versions WHERE note_id = ? ORDER BY saved_at DESC LIMIT 1')
		.get(id) as { savedAt: string } | undefined;
	const quietSince = !last || Date.now() - Date.parse(last.savedAt) > VERSION_EVERY_MS;
	const bigLoss = oldText.length > 40 && plainText(nextBody).length < oldText.length / 2;
	if (!quietSince && !bigLoss) return;

	saveVersion(id, before.title, before.body);
}

function saveVersion(id: number, title: string, body: string): void {
	db.prepare('INSERT INTO note_versions (note_id, title, body, saved_at) VALUES (?, ?, ?, ?)').run(
		id,
		title,
		body,
		new Date().toISOString()
	);
	db.prepare(
		`DELETE FROM note_versions WHERE note_id = ? AND id NOT IN
		 (SELECT id FROM note_versions WHERE note_id = ? ORDER BY saved_at DESC LIMIT ${MAX_VERSIONS})`
	).run(id, id);
}

export function listVersions(noteId: number): NoteVersion[] {
	return plainAll<NoteVersion>(
		db
			.prepare('SELECT id, title, body, saved_at AS savedAt FROM note_versions WHERE note_id = ? ORDER BY saved_at DESC')
			.all(noteId)
	);
}

/** Puts an old version back. What the note says now is kept as a version first, so this can be undone too. */
export function restoreVersion(noteId: number, versionId: number): boolean {
	const version = db
		.prepare('SELECT title, body FROM note_versions WHERE id = ? AND note_id = ?')
		.get(versionId, noteId) as { title: string; body: string } | undefined;
	const current = db.prepare('SELECT title, body FROM notes WHERE id = ?').get(noteId) as { title: string; body: string } | undefined;
	if (!version || !current) return false;

	saveVersion(noteId, current.title, current.body);
	db.prepare('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?').run(
		version.title,
		version.body,
		new Date().toISOString(),
		noteId
	);
	return true;
}
