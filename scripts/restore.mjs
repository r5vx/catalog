/**
 * Rebuilds your library from library.json.
 *
 * A backup nobody has ever restored is a rumour, so this exists to be run — and
 * it is run as part of setting backups up, against a throwaway copy.
 *
 *   node scripts/restore.mjs                  # preview only, changes nothing
 *   node scripts/restore.mjs --write          # overwrite your real library
 *   node scripts/restore.mjs --write --to X   # rebuild into a different file
 *   node scripts/restore.mjs --from X         # use a downloaded backup
 */
import { DatabaseSync } from 'node:sqlite';
import { constants, copyFileSync, readFileSync, existsSync, renameSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { dbPath, backupDir } from './paths.mjs';

const args = process.argv.slice(2);
const write = args.includes('--write');
function pathArg(flag, fallback) {
	const at = args.indexOf(flag);
	if (at === -1) return fallback;
	const value = args[at + 1];
	if (!value || value.startsWith('--')) {
		console.error(`${flag} needs a file path.`);
		process.exit(1);
	}
	return value;
}

const target = pathArg('--to', dbPath());
const sourceFile = pathArg('--from', join(backupDir(), 'library.json'));

if (resolve(target) === resolve(sourceFile)) {
	console.error('Pick a different path for the rebuilt database.');
	process.exit(1);
}

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

const schema = `
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
	CREATE TABLE note_tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE COLLATE NOCASE
	);
	CREATE TABLE note_tag_links (
		note_id INTEGER NOT NULL,
		tag_id INTEGER NOT NULL,
		PRIMARY KEY (note_id, tag_id)
	);
	CREATE TABLE note_versions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		note_id INTEGER NOT NULL,
		title TEXT NOT NULL,
		body TEXT NOT NULL,
		saved_at TEXT NOT NULL
	);
	CREATE TABLE my_watch_orders (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		added_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE TABLE entry_tags (
		entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
		tag_id   INTEGER NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
		PRIMARY KEY (entry_id, tag_id)
	);
`;

const identifier = (name) => `"${name.replaceAll('"', '""')}"`;

/** Insert rows using whatever columns the backup actually has. */
function restore(db, table, records) {
	if (records.length === 0) return;

	const columns = Object.keys(records[0]);

	// Columns added since the tables above were written (notes' locked/deleted_at, entries'
	// last_season…): add them, or every insert fails. The app fills in the rest on start.
	const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
	for (const column of columns) {
		if (!existing.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${identifier(column)}`);
	}

	const statement = db.prepare(
		`INSERT INTO ${table} (${columns.map(identifier).join(',')}) VALUES (${columns.map(() => '?').join(',')})`
	);

	for (const record of records) {
		statement.run(...columns.map((column) => record[column] ?? null));
	}
}

function requireClosedLibrary() {
	if (['-wal', '-shm', '-journal'].some((suffix) => existsSync(`${target}${suffix}`))) {
		throw new Error('Close Catalog before restoring. If the previous run crashed, open and close it normally first.');
	}
}

let staging;
try {
	requireClosedLibrary();
	mkdirSync(dirname(target), { recursive: true });
	staging = mkdtempSync(join(dirname(target), '.catalog-restore-'));
	const rebuilt = join(staging, 'library.db');
	const db = new DatabaseSync(rebuilt);
	try {
		db.exec('BEGIN');
		db.exec(schema);
		restore(db, 'categories', backup.categories);
		restore(db, 'entries', backup.entries);
		restore(db, 'tags', backup.tags);
		restore(db, 'entry_tags', backup.entryTags);
		restore(db, 'notes', backup.notes ?? []);
		restore(db, 'note_tags', backup.noteTags ?? []);
		restore(db, 'note_tag_links', backup.noteTagLinks ?? []);
		restore(db, 'note_versions', backup.noteVersions ?? []);
		restore(db, 'my_watch_orders', backup.watchOrders ?? []);
		restore(db, 'people', backup.people ?? []);
		restore(db, 'entry_cast', backup.entryCast ?? []);
		db.exec('COMMIT');
	} finally {
		db.close();
	}

	requireClosedLibrary();
	if (existsSync(target)) {
		const aside = `${target}.replaced-${Date.now()}`;
		copyFileSync(target, aside, constants.COPYFILE_EXCL);
		console.log(`\nPrevious library saved to ${aside}`);
	}
	renameSync(rebuilt, target);
	console.log(`\nRestored ${backup.entries.length} entries into ${target}`);
} catch (error) {
	console.error(`Restore failed: ${error.message}`);
	process.exitCode = 1;
} finally {
	if (staging) rmSync(staging, { recursive: true, force: true });
}
