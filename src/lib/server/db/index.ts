import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * SQLite is built into Node itself, so this app has no database driver to
 * install, compile, or keep up to date. Your entire library is one file.
 *
 * It lives in the same place whether you open the Catalog app or run
 * `npm run dev`, so there's only ever one library to think about (and only one
 * file to back up). On Windows that's %APPDATA%\Catalog\library.db.
 */
function defaultDbPath(): string {
	const base =
		process.env.APPDATA ??
		(process.platform === 'darwin'
			? join(homedir(), 'Library', 'Application Support')
			: join(homedir(), '.local', 'share'));

	return join(base, 'Catalog', 'library.db');
}

export const dbPath = process.env.CATALOG_DB || defaultDbPath();

/** The folder holding your library, your settings, and your backups. */
export const dataDir = dirname(dbPath);

mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
	CREATE TABLE IF NOT EXISTS categories (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		slug TEXT NOT NULL UNIQUE,
		emoji TEXT NOT NULL DEFAULT '📁',
		sort_order INTEGER NOT NULL DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS entries (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
		title TEXT NOT NULL,
		year INTEGER,
		status TEXT NOT NULL DEFAULT 'completed',
		rating REAL,
		rewatches INTEGER NOT NULL DEFAULT 0,
		favorite INTEGER NOT NULL DEFAULT 0,
		notes TEXT NOT NULL DEFAULT '',
		started_on TEXT,
		finished_on TEXT,
		poster_url TEXT,
		overview TEXT,
		source TEXT NOT NULL DEFAULT 'manual',
		source_id TEXT,
		runtime_minutes INTEGER,
		episodes_total INTEGER,
		episodes_watched INTEGER,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	CREATE INDEX IF NOT EXISTS entries_category_idx ON entries(category_id);
	CREATE INDEX IF NOT EXISTS entries_title_idx    ON entries(title);
	CREATE INDEX IF NOT EXISTS entries_status_idx   ON entries(status);

	CREATE TABLE IF NOT EXISTS notes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		title TEXT NOT NULL DEFAULT 'Untitled',
		body TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		-- genre / studio / director / franchise, so the filter can group them
		kind TEXT NOT NULL DEFAULT 'other'
	);

	-- Who appears in what. Normalised so "everything with this actor" is one
	-- lookup rather than a scan through every entry.
	CREATE TABLE IF NOT EXISTS people (
		id        INTEGER PRIMARY KEY AUTOINCREMENT,
		source_id TEXT NOT NULL UNIQUE,
		name      TEXT NOT NULL,
		photo     TEXT
	);

	CREATE TABLE IF NOT EXISTS entry_cast (
		entry_id  INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
		person_id INTEGER NOT NULL REFERENCES people(id)  ON DELETE CASCADE,
		character TEXT,
		ord       INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (entry_id, person_id)
	);

	CREATE INDEX IF NOT EXISTS entry_cast_person_idx ON entry_cast(person_id);
	CREATE INDEX IF NOT EXISTS people_name_idx ON people(name);

	CREATE TABLE IF NOT EXISTS entry_tags (
		entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
		tag_id   INTEGER NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
		PRIMARY KEY (entry_id, tag_id)
	);
`);

// Three starter categories on a brand new library. They're ordinary rows —
// delete them, rename them, or add your own.
const { count } = db.prepare('SELECT COUNT(*) AS count FROM categories').get() as {
	count: number;
};

if (count === 0) {
	const insert = db.prepare(
		'INSERT INTO categories (name, slug, emoji, sort_order) VALUES (?, ?, ?, ?)'
	);
	insert.run('Movies', 'movies', '\u{1F3AC}', 0);
	insert.run('TV Shows', 'tv', '\u{1F4FA}', 1);
	insert.run('Anime', 'anime', '\u{1F338}', 2);
}

/**
 * Columns added after the first version. SQLite has no "ADD COLUMN IF NOT
 * EXISTS", so we check what's there and add what's missing. Safe to re-run.
 */
const existing = new Set(
	(db.prepare('PRAGMA table_info(entries)').all() as { name: string }[]).map((c) => c.name)
);

const laterColumns: Record<string, string> = {
	// What everyone else scored it out of 10, so you can sort by that as well as
	// by your own rating.
	external_rating: 'REAL',
	external_votes: 'INTEGER',
	// How far into a series you got: "(S1E23)" in an imported list.
	last_season: 'INTEGER',
	last_episode: 'INTEGER',
	// Kept fresh by `npm run refresh`, so the app can tell you when a show you
	// were watching has put out episodes you haven't seen.
	show_status: 'TEXT',
	season_counts: 'TEXT',
	next_air_date: 'TEXT',
	checked_at: 'TEXT',
	// Scores from everywhere else, fetched from OMDb and kept so the page can
	// show them instantly. `scores_checked_at` is what stops us asking again
	// for something we looked up last week.
	imdb_id: 'TEXT',
	imdb_rating: 'REAL',
	imdb_votes: 'INTEGER',
	rt_score: 'INTEGER',
	metascore: 'INTEGER',
	content_rating: 'TEXT',
	awards: 'TEXT',
	box_office: 'INTEGER',
	scores_checked_at: 'TEXT'
};

for (const [name, type] of Object.entries(laterColumns)) {
	if (!existing.has(name)) db.exec(`ALTER TABLE entries ADD COLUMN ${name} ${type}`);
}

// Notes can be locked behind the PIN, one by one.
const noteColumns = new Set(
	(db.prepare('PRAGMA table_info(notes)').all() as { name: string }[]).map((c) => c.name)
);
if (!noteColumns.has('locked')) {
	db.exec('ALTER TABLE notes ADD COLUMN locked INTEGER NOT NULL DEFAULT 0');
}

// `tags` predates the kind column, so add it to an existing table too.
const tagColumns = new Set(
	(db.prepare('PRAGMA table_info(tags)').all() as { name: string }[]).map((c) => c.name)
);
if (!tagColumns.has('kind')) {
	db.exec("ALTER TABLE tags ADD COLUMN kind TEXT NOT NULL DEFAULT 'other'");
}

/**
 * node:sqlite hands back null-prototype objects. SvelteKit needs plain ones to
 * send them to the browser, so every query result goes through here.
 */
export function plain<T>(row: unknown): T {
	return { ...(row as object) } as T;
}

export function plainAll<T>(rows: unknown[]): T[] {
	return rows.map((row) => plain<T>(row));
}

/** SQLite has no boolean type — it stores 0 and 1. */
export const toInt = (value: boolean) => (value ? 1 : 0);
