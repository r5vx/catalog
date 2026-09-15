import { db, plainAll } from './index';

export type CastMember = {
	id: number;
	sourceId: string;
	name: string;
	photo: string | null;
	character: string | null;
	ord: number;
};

export type Person = { id: number; sourceId: string; name: string; photo: string | null };

/** Replace an entry's cast. Order is billing order, as the database gives it. */
export function setCast(
	entryId: number,
	cast: { sourceId: string; name: string; photo: string | null; character: string | null }[]
): void {
	db.prepare('DELETE FROM entry_cast WHERE entry_id = ?').run(entryId);

	const find = db.prepare('SELECT id FROM people WHERE source_id = ?');
	const add = db.prepare('INSERT INTO people (source_id, name, photo) VALUES (?, ?, ?)');
	const refresh = db.prepare('UPDATE people SET name = ?, photo = ? WHERE id = ?');
	const link = db.prepare(
		'INSERT OR IGNORE INTO entry_cast (entry_id, person_id, character, ord) VALUES (?, ?, ?, ?)'
	);

	cast.forEach((member, index) => {
		if (!member.sourceId || !member.name) return;

		const existing = find.get(member.sourceId) as { id: number } | undefined;
		const personId = existing
			? (refresh.run(member.name, member.photo, existing.id), existing.id)
			: Number(add.run(member.sourceId, member.name, member.photo).lastInsertRowid);

		link.run(entryId, personId, member.character, index);
	});
}

export function castForEntry(entryId: number): CastMember[] {
	return plainAll<CastMember>(
		db
			.prepare(
				`SELECT p.id, p.source_id AS sourceId, p.name, p.photo, ec.character, ec.ord
				 FROM entry_cast ec JOIN people p ON p.id = ec.person_id
				 WHERE ec.entry_id = ? ORDER BY ec.ord`
			)
			.all(entryId)
	);
}

export function getPerson(id: number): Person | null {
	const row = db
		.prepare('SELECT id, source_id AS sourceId, name, photo FROM people WHERE id = ?')
		.get(id);

	return row ? ({ ...(row as object) } as Person) : null;
}

/** Everything in your library featuring this person. */
export function entriesWithPerson(personId: number) {
	return plainAll<{
		id: number;
		title: string;
		year: number | null;
		posterUrl: string | null;
		character: string | null;
		categoryName: string;
		categoryEmoji: string;
	}>(
		db
			.prepare(
				`SELECT e.id, e.title, e.year, e.poster_url AS posterUrl, ec.character,
				        c.name AS categoryName, c.emoji AS categoryEmoji
				 FROM entry_cast ec
				 JOIN entries e ON e.id = ec.entry_id
				 JOIN categories c ON c.id = e.category_id
				 WHERE ec.person_id = ?
				 ORDER BY e.year DESC, e.title`
			)
			.all(personId)
	);
}

/**
 * Find people by name, matching each word separately.
 *
 * "samuel jackson" has to find "Samuel L. Jackson" — a plain LIKE on the whole
 * phrase never will, because of the middle initial. Requiring every word to
 * appear somewhere in the name handles initials, middle names and word order.
 */
export function searchPeople(query: string, limit = 40) {
	const words = query.trim().split(/\s+/).filter((w) => w.length > 0);
	if (words.length === 0) return [];

	const conditions = words.map(() => 'p.name LIKE ?').join(' AND ');
	const params = words.map((w) => `%${w}%`);

	return plainAll<{
		id: number;
		name: string;
		photo: string | null;
		count: number;
		sample: string;
	}>(
		db
			.prepare(
				`SELECT p.id, p.name, p.photo,
				        COUNT(ec.entry_id) AS count,
				        (SELECT e.title FROM entries e
				          JOIN entry_cast x ON x.entry_id = e.id
				         WHERE x.person_id = p.id ORDER BY x.ord LIMIT 1) AS sample
				 FROM people p
				 JOIN entry_cast ec ON ec.person_id = p.id
				 WHERE ${conditions}
				 GROUP BY p.id
				 ORDER BY count DESC, p.name
				 LIMIT ?`
			)
			.all(...params, limit)
	);
}

/**
 * Every title in the library, normalised for comparison.
 *
 * "Also known for" has to exclude things you already have, and it can't rely on
 * the cast links: a cameo (Samuel L. Jackson in Iron Man) falls outside the
 * stored top-15 billing, so the entry exists but isn't linked to him.
 */
export function allTitleKeys(): Set<string> {
	const rows = db.prepare('SELECT title, year FROM entries').all() as {
		title: string;
		year: number | null;
	}[];

	const keys = new Set<string>();
	for (const row of rows) {
		const name = row.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
		keys.add(name);
		if (row.year) keys.add(`${name}|${row.year}`);
	}
	return keys;
}

/** Cheap check so the entry page can hide an empty cast section. */
export function hasAnyCast(): boolean {
	return Boolean((db.prepare('SELECT 1 FROM entry_cast LIMIT 1').get() as unknown));
}
