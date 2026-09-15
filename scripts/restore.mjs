/**
 * Rebuilds your library from library.json.
 *
 * A backup nobody has ever restored is a rumour, so this exists to be run — and
 * it is run as part of setting backups up, against a throwaway copy.
 *
 *   node scripts/restore.mjs                  # preview only, changes nothing
 *   node scripts/restore.mjs --write          # overwrite your real library
 *   node scripts/restore.mjs --write --to X   # rebuild into a different file
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { dbPath, backupDir } from './paths.mjs';

const args = process.argv.slice(2);
const write = args.includes('--write');
const toIndex = args.indexOf('--to');
const target = toIndex !== -1 ? args[toIndex + 1] : dbPath();

const sourceFile = join(backupDir(), 'library.json');

if (!existsSync(sourceFile)) {
	console.error(`No backup found at ${sourceFile}. Run "npm run backup" first.`);
	process.exit(1);
}

const backup = JSON.parse(readFileSync(sourceFile, 'utf8'));

console.log(`Backup taken ${backup.exportedAt}`);
console.log(`  ${backup.categories.length} categories`);
console.log(`  ${backup.entries.length} entries`);
console.log(`  ${backup.tags.length} tags`);
console.log(`  ${(backup.notes ?? []).length} note pages`);

if (!write) {
	console.log(`\nPreview only. Nothing was changed.`);
	console.log(`Re-run with --write to rebuild ${target}`);
	process.exit(0);
}

// Never destroy the current library without keeping it.
if (existsSync(target)) {
	const aside = `${target}.replaced-${Date.now()}`;
	renameSync(target, aside);
	console.log(`\nExisting library moved aside to ${aside}`);
}

mkdirSync(dirname(target), { recursive: true });
const db = new DatabaseSync(target);

db.exec(`
	CREATE TABLE categories (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		slug TEXT NOT NULL UNIQUE,
		emoji TEXT NOT NULL DEFAULT '📁',
		sort_order INTEGER NOT NULL DEFAULT 0
	);
	CREATE TABLE entries (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
		title TEXT NOT NULL, year INTEGER,
		status TEXT NOT NULL DEFAULT 'completed', rating REAL,
		rewatches INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0,
		notes TEXT NOT NULL DEFAULT '', started_on TEXT, finished_on TEXT,
		poster_url TEXT, overview TEXT,
		source TEXT NOT NULL DEFAULT 'manual', source_id TEXT,
		runtime_minutes INTEGER, episodes_total INTEGER, episodes_watched INTEGER,
		created_at TEXT NOT NULL, updated_at TEXT NOT NULL
	);
	CREATE INDEX entries_category_idx ON entries(category_id);
	CREATE INDEX entries_title_idx    ON entries(title);
	CREATE INDEX entries_status_idx   ON entries(status);
	CREATE TABLE tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE
	);
	CREATE TABLE notes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		title TEXT NOT NULL DEFAULT 'Untitled',
		body TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
	CREATE TABLE people (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		source_id TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		photo TEXT
	);
	CREATE TABLE entry_cast (
		entry_id INTEGER NOT NULL, person_id INTEGER NOT NULL,
		character TEXT, ord INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (entry_id, person_id)
	);
	CREATE TABLE entry_tags (
		entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
		tag_id   INTEGER NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
		PRIMARY KEY (entry_id, tag_id)
	);
`);

/** Insert rows using whatever columns the backup actually has. */
function restore(table, records) {
	if (records.length === 0) return;

	const columns = Object.keys(records[0]);
	const statement = db.prepare(
		`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`
	);

	for (const record of records) {
		statement.run(...columns.map((column) => record[column] ?? null));
	}
}

restore('categories', backup.categories);
restore('entries', backup.entries);
restore('tags', backup.tags);
restore('entry_tags', backup.entryTags);
restore('notes', backup.notes ?? []);
restore('people', backup.people ?? []);
restore('entry_cast', backup.entryCast ?? []);

const count = db.prepare('SELECT COUNT(*) AS n FROM entries').get().n;
db.close();

console.log(`\nRestored ${count} entries into ${target}`);
