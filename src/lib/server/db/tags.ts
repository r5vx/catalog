import { db, plainAll } from './index';
import type { DerivedTag } from '../metadata/details';

export type TagOption = { id: number; name: string; kind: string; count: number };

/** Replace an entry's tags with the given set. */
export function setTags(entryId: number, tags: DerivedTag[]): void {
	db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(entryId);
	if (tags.length === 0) return;

	const findTag = db.prepare('SELECT id FROM tags WHERE name = ?');
	const addTag = db.prepare('INSERT INTO tags (name, kind) VALUES (?, ?)');
	const link = db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)');

	for (const tag of tags) {
		const name = tag.name.trim();
		if (!name) continue;

		const existing = findTag.get(name) as { id: number } | undefined;
		const id = existing?.id ?? Number(addTag.run(name, tag.kind).lastInsertRowid);
		link.run(entryId, id);
	}
}

/** Every tag actually in use, commonest first. */
export function listTags(): TagOption[] {
	return plainAll<TagOption>(
		db
			.prepare(
				`SELECT t.id, t.name, t.kind, COUNT(et.entry_id) AS count
				 FROM tags t
				 JOIN entry_tags et ON et.tag_id = t.id
				 GROUP BY t.id
				 HAVING count > 0
				 ORDER BY count DESC, t.name ASC`
			)
			.all()
	);
}

export function tagsForEntry(entryId: number): TagOption[] {
	return plainAll<TagOption>(
		db
			.prepare(
				`SELECT t.id, t.name, t.kind, 0 AS count
				 FROM tags t JOIN entry_tags et ON et.tag_id = t.id
				 WHERE et.entry_id = ? ORDER BY t.kind, t.name`
			)
			.all(entryId)
	);
}

/** Drop tags no entry uses any more, so the filter list stays honest. */
export function pruneTags(): void {
	db.exec('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM entry_tags)');
}
