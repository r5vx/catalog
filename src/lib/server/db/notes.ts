import { db, plainAll, plain } from './index';

export type Note = {
	id: number;
	title: string;
	body: string;
	locked: boolean;
	createdAt: string;
	updatedAt: string;
};

const COLUMNS =
	'id, title, body, locked, created_at AS createdAt, updated_at AS updatedAt';

/**
 * Titles only — the list page doesn't need every note's full contents.
 *
 * A locked note's preview is left empty **in SQL**, so its text never reaches
 * the page at all. Hiding it in the template would still have sent it.
 */
export function listNotes() {
	return plainAll<Omit<Note, 'body'> & { preview: string }>(
		db
			.prepare(
				`SELECT id, title, locked, created_at AS createdAt, updated_at AS updatedAt,
				        CASE WHEN locked = 1 THEN ''
				             ELSE substr(replace(replace(body, '<', ' <'), '>', '> '), 1, 400)
				        END AS preview
				 FROM notes ORDER BY updated_at DESC`
			)
			.all()
	).map((note) => ({ ...note, locked: Boolean(note.locked) }));
}

export function countNotes(): number {
	return (db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n;
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
	db.prepare('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?').run(
		title,
		body,
		new Date().toISOString(),
		id
	);
}

export function deleteNote(id: number): void {
	db.prepare('DELETE FROM notes WHERE id = ?').run(id);
}
