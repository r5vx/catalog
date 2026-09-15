import { db, plainAll, plain } from './index';

export type Note = {
	id: number;
	title: string;
	body: string;
	createdAt: string;
	updatedAt: string;
};

const COLUMNS = 'id, title, body, created_at AS createdAt, updated_at AS updatedAt';

/** Titles only — the list page doesn't need every note's full contents. */
export function listNotes() {
	return plainAll<Omit<Note, 'body'> & { preview: string }>(
		db
			.prepare(
				`SELECT id, title, created_at AS createdAt, updated_at AS updatedAt,
				        substr(replace(replace(body, '<', ' <'), '>', '> '), 1, 400) AS preview
				 FROM notes ORDER BY updated_at DESC`
			)
			.all()
	);
}

export function countNotes(): number {
	return (db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n;
}

export function getNote(id: number): Note | null {
	const row = db.prepare(`SELECT ${COLUMNS} FROM notes WHERE id = ?`).get(id);
	return row ? plain<Note>(row) : null;
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
