import { DatabaseSync } from 'node:sqlite';
import { slimSubtitle } from '../subtitleFonts';
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
	scores_checked_at: 'TEXT',
	// When the detail endpoint was last asked about this title. Some things
	// genuinely have no runtime and no synopsis to give — a stamp is the only
	// way to tell those apart from the ones nobody has looked up yet.
	details_checked_at: 'TEXT',
	// Where you can stream it, as JSON, with the date it was fetched. Cached
	// because availability moves slowly and the page shouldn't wait on it.
	providers: 'TEXT',
	providers_checked_at: 'TEXT',
	// Its other names, one per line ("Dungeon Meshi" for Delicious in Dungeon), so searching
	// finds it either way. NULL until asked (src/lib/server/otherNames.ts).
	other_titles: 'TEXT'
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

// Deleting a note moves it to Recently deleted for 7 days instead of erasing it.
if (!noteColumns.has('deleted_at')) {
	db.exec('ALTER TABLE notes ADD COLUMN deleted_at TEXT');
}

// Pinned notes stay at the top of the list, whatever the sort.
if (!noteColumns.has('pinned')) {
	db.exec('ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
}

// Tags for notes ("School", "Work"…). Separate from the library's tags, which are genres.
db.exec(`
	CREATE TABLE IF NOT EXISTS note_tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE COLLATE NOCASE
	);
	CREATE TABLE IF NOT EXISTS note_tag_links (
		note_id INTEGER NOT NULL,
		tag_id INTEGER NOT NULL,
		PRIMARY KEY (note_id, tag_id)
	);
`);

// Earlier versions of each note, so a page wiped by accident can be brought back.
db.exec(`
	CREATE TABLE IF NOT EXISTS note_versions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		note_id INTEGER NOT NULL,
		title TEXT NOT NULL,
		body TEXT NOT NULL,
		saved_at TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS note_versions_note_idx ON note_versions(note_id, saved_at);
`);

// `tags` predates the kind column, so add it to an existing table too.
const tagColumns = new Set(
	(db.prepare('PRAGMA table_info(tags)').all() as { name: string }[]).map((c) => c.name)
);
if (!tagColumns.has('kind')) {
	db.exec("ALTER TABLE tags ADD COLUMN kind TEXT NOT NULL DEFAULT 'other'");
}

db.exec(`
	CREATE TABLE IF NOT EXISTS watch_progress (
		title TEXT NOT NULL,
		type TEXT NOT NULL DEFAULT 'movie',
		season INTEGER NOT NULL DEFAULT 0,
		episode INTEGER NOT NULL DEFAULT 0,
		current_time REAL NOT NULL DEFAULT 0,
		duration REAL NOT NULL DEFAULT 0,
		updated_at TEXT NOT NULL DEFAULT (datetime('now')),
		PRIMARY KEY (title, type, season, episode)
	)
`);

db.exec(`
	CREATE TABLE IF NOT EXISTS shared_catalogs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		titles_count INTEGER NOT NULL DEFAULT 0,
		data TEXT NOT NULL,
		imported_at TEXT NOT NULL DEFAULT (datetime('now'))
	)
`);

// Removing a card from Continue Watching hides it here; the episode progress (the green ticks) is kept.
db.exec(`
	CREATE TABLE IF NOT EXISTS continue_hidden (
		title TEXT NOT NULL,
		type TEXT NOT NULL,
		hidden_at TEXT NOT NULL DEFAULT (datetime('now')),
		PRIMARY KEY (title, type)
	)
`);

// Something on your watchlist that you then start or finish counts as newly added, so it
// comes up at the top of "Recently added" rather than wherever it was put on the list.
db.exec(`
	CREATE TRIGGER IF NOT EXISTS planned_to_watched
	AFTER UPDATE OF status ON entries
	WHEN OLD.status = 'planned' AND NEW.status IN ('completed', 'watching', 'rewatching', 'caught_up')
	BEGIN
		UPDATE entries SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
	END
`);

// Watch orders you've added: a hand-made list ("mcu") or a TMDB film collection ("collection-10").
db.exec(`
	CREATE TABLE IF NOT EXISTS my_watch_orders (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		added_at TEXT NOT NULL DEFAULT (datetime('now'))
	)
`);

// What TMDB said about each watch-order title and film series, so opening a watch order
// doesn't wait on a hundred lookups every time the app starts. JSON, keyed by lookup.
db.exec(`
	CREATE TABLE IF NOT EXISTS watch_order_cache (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		saved_at INTEGER NOT NULL
	)
`);

// Watch-order extras (Marvel One-Shots and the like) you've seen. Kept out of the library
// on purpose, so a five-minute short doesn't turn up under Movies. Keyed by "movie:76122".
db.exec(`
	CREATE TABLE IF NOT EXISTS watched_extras (
		source_id TEXT PRIMARY KEY,
		watched_at TEXT NOT NULL DEFAULT (datetime('now'))
	)
`);

// Subtitle files kept on this PC for a show you're watching, so they load instantly and don't
// depend on the site staying up. Cleared once the show is finished, unwatched for a week, or
// taken off Continue Watching (forgetFinishedSubtitles). A few dozen KB each.
db.exec(`
	CREATE TABLE IF NOT EXISTS saved_subtitles (
		url TEXT PRIMARY KEY,
		show TEXT NOT NULL,
		content TEXT NOT NULL,
		saved_at TEXT NOT NULL DEFAULT (datetime('now'))
	)
`);
db.exec('CREATE INDEX IF NOT EXISTS saved_subtitles_show ON saved_subtitles (show)');

// Watch-list titles you've chosen to skip: no longer "up next", and not counted. Keyed like
// the list items, "movie:1726:1" (type, TMDB id, season).
db.exec(`
	CREATE TABLE IF NOT EXISTS skipped_titles (
		item_key TEXT PRIMARY KEY,
		skipped_at TEXT NOT NULL DEFAULT (datetime('now'))
	)
`);

// Which AniList entry is the first season of the show an entry belongs to (itself, if none).
db.exec(`
	CREATE TABLE IF NOT EXISTS anime_roots (
		id INTEGER PRIMARY KEY,
		root INTEGER NOT NULL,
		checked_at TEXT NOT NULL DEFAULT (datetime('now'))
	)
`);

// Fixes that should run once on an existing library, by name.
db.exec('CREATE TABLE IF NOT EXISTS one_time_fixes (name TEXT PRIMARY KEY, done_at TEXT NOT NULL)');
function once(name: string, fix: () => void): void {
	if (db.prepare('SELECT 1 FROM one_time_fixes WHERE name = ?').get(name)) return;
	fix();
	db.prepare("INSERT INTO one_time_fixes (name, done_at) VALUES (?, datetime('now'))").run(name);
}

// Shows are now also grouped the way TMDB groups them (JoJo's parts are one show), so the
// saved groupings from before need working out again.
once('anime-roots-tmdb-seasons', () => db.exec('DELETE FROM anime_roots'));

// Subtitles kept with fonts and drawings inside (32 MB a file for Re:Zero's): those go, then the
// space they took, and any other empty space, is given back (the library was 190 MB, 120 MB of
// it nothing). From then on the file gives space back as things are deleted.
once('subtitles-slimmed', () => {
	const big = db.prepare('SELECT url, content FROM saved_subtitles WHERE length(content) > 500000').all() as { url: string; content: string }[];
	const update = db.prepare('UPDATE saved_subtitles SET content = ? WHERE url = ?');
	for (const row of big) update.run(slimSubtitle(row.content), row.url);
	db.exec('PRAGMA auto_vacuum = INCREMENTAL');
	db.exec('VACUUM');
	db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
});

// Which Showbox entry a title opened as, so the slow search is skipped after a restart.
db.exec(`
	CREATE TABLE IF NOT EXISTS showbox_matches (
		lookup TEXT PRIMARY KEY,
		showbox_id INTEGER NOT NULL,
		title TEXT NOT NULL,
		type TEXT NOT NULL,
		poster_url TEXT NOT NULL DEFAULT '',
		share_key TEXT NOT NULL,
		start_season INTEGER NOT NULL DEFAULT 0,
		saved_at TEXT NOT NULL DEFAULT (datetime('now'))
	)
`);

try { db.exec("ALTER TABLE watch_progress ADD COLUMN sub_url TEXT NOT NULL DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE watch_progress ADD COLUMN sub_delay REAL NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE watch_progress ADD COLUMN sub_file_name TEXT NOT NULL DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE watch_progress ADD COLUMN poster_url TEXT NOT NULL DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE watch_progress ADD COLUMN share_key TEXT NOT NULL DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE watch_progress ADD COLUMN fid INTEGER NOT NULL DEFAULT 0"); } catch {}

// Who's watching, on the TV (src/lib/server/profile.ts). Profile 0 is the library's owner and
// has no row until it's given a name; everyone else's list of titles is in profile_titles.
// A deleted profile's number is never given out again, so a TV still set to it can't land in
// someone new's profile.
db.exec(`
	CREATE TABLE IF NOT EXISTS profiles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		color TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	)
`);
db.exec(`
	CREATE TABLE IF NOT EXISTS profile_titles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		profile INTEGER NOT NULL,
		source TEXT NOT NULL,
		source_id TEXT NOT NULL,
		title TEXT NOT NULL,
		year INTEGER,
		category TEXT NOT NULL,
		poster_url TEXT,
		overview TEXT,
		status TEXT NOT NULL,
		last_season INTEGER,
		last_episode INTEGER,
		updated_at TEXT NOT NULL DEFAULT (datetime('now')),
		UNIQUE (profile, source, source_id)
	)
`);

// Watch progress and Continue Watching belong to a profile. The key changes, which SQLite can
// only do by copying into a new table; everything there so far is the owner's (profile 0).
once('progress-per-profile', () => {
	const PROGRESS_COLUMNS = ['title', 'type', 'season', 'episode', '"current_time"', 'duration', 'updated_at', 'sub_url', 'sub_delay', 'sub_file_name', 'poster_url', 'share_key', 'fid'].join(', ');
	db.exec('BEGIN');
	try {
		db.exec(`
			CREATE TABLE watch_progress_new (
				profile INTEGER NOT NULL DEFAULT 0,
				title TEXT NOT NULL,
				type TEXT NOT NULL DEFAULT 'movie',
				season INTEGER NOT NULL DEFAULT 0,
				episode INTEGER NOT NULL DEFAULT 0,
				"current_time" REAL NOT NULL DEFAULT 0,
				duration REAL NOT NULL DEFAULT 0,
				updated_at TEXT NOT NULL DEFAULT (datetime('now')),
				sub_url TEXT NOT NULL DEFAULT '',
				sub_delay REAL NOT NULL DEFAULT 0,
				sub_file_name TEXT NOT NULL DEFAULT '',
				poster_url TEXT NOT NULL DEFAULT '',
				share_key TEXT NOT NULL DEFAULT '',
				fid INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (profile, title, type, season, episode)
			)
		`);
		db.exec(`INSERT INTO watch_progress_new (${PROGRESS_COLUMNS}) SELECT ${PROGRESS_COLUMNS} FROM watch_progress`);
		db.exec('DROP TABLE watch_progress');
		db.exec('ALTER TABLE watch_progress_new RENAME TO watch_progress');

		db.exec(`
			CREATE TABLE continue_hidden_new (
				profile INTEGER NOT NULL DEFAULT 0,
				title TEXT NOT NULL,
				type TEXT NOT NULL,
				hidden_at TEXT NOT NULL DEFAULT (datetime('now')),
				PRIMARY KEY (profile, title, type)
			)
		`);
		db.exec('INSERT INTO continue_hidden_new (title, type, hidden_at) SELECT title, type, hidden_at FROM continue_hidden');
		db.exec('DROP TABLE continue_hidden');
		db.exec('ALTER TABLE continue_hidden_new RENAME TO continue_hidden');
		db.exec('COMMIT');
	} catch (error) {
		db.exec('ROLLBACK');
		throw error;
	}
});

/**
 * Shows someone has watched to the last episode there was to play (src/lib/server/newEpisodes.ts).
 * They leave Continue Watching, and come back with a "New" mark when a later episode can be
 * played. `known_*`: the last episode that could be played when last looked (NULL: not looked yet,
 * so nothing found on the first look counts as new). `new_*`: the first new one, once found.
 */
db.exec(`
	CREATE TABLE IF NOT EXISTS caught_up (
		profile INTEGER NOT NULL,
		title TEXT NOT NULL,
		year TEXT NOT NULL DEFAULT '',
		season INTEGER NOT NULL,
		episode INTEGER NOT NULL,
		known_season INTEGER,
		known_episode INTEGER,
		finished_at TEXT NOT NULL DEFAULT (datetime('now')),
		new_season INTEGER,
		new_episode INTEGER,
		found_at TEXT,
		dismissed INTEGER NOT NULL DEFAULT 0,
		checked_at TEXT,
		PRIMARY KEY (profile, title)
	)
`);

// Continue Watching used to drop a show marked completed once its latest episode was 90% in —
// Re:Zero vanished at 25:00 of 27:29 midway through season 2. Now only reaching the last episode
// there is, or Remove, takes a show off. So nothing jumps back on, what that rule was hiding stays
// hidden: watched to the end, it counts as caught up (and gets new-episode checks); left midway, it's
// as if Remove had been pressed (it comes back when played again).
once('continue-not-by-status', () => {
	const hidden = db
		.prepare(`
			SELECT w.profile, w.title, w.season, w.episode, w.updated_at AS updatedAt,
				w.duration > 0 AND CAST(w."current_time" AS REAL) / w.duration >= 0.9 AS finished
			FROM watch_progress w
			WHERE w.type = 'tv' AND w.rowid = (
				SELECT w2.rowid FROM watch_progress w2
				WHERE w2.profile = w.profile AND w2.title = w.title AND w2.type = w.type
				ORDER BY w2.updated_at DESC, w2.season DESC, w2.episode DESC LIMIT 1
			)
			AND EXISTS (
				SELECT 1 FROM (
					SELECT 0 AS profile, title, status, updated_at FROM entries
					UNION ALL SELECT profile, title, status, updated_at FROM profile_titles
				) e
				WHERE e.profile = w.profile AND lower(e.title) = lower(w.title) AND e.status = 'completed'
					AND (w.duration = 0 OR CAST(w."current_time" AS REAL) / w.duration >= 0.9
						OR datetime(w.updated_at) <= datetime(e.updated_at))
			)
		`)
		.all() as { profile: number; title: string; season: number; episode: number; updatedAt: string; finished: number }[];
	const caughtUp = db.prepare('INSERT OR IGNORE INTO caught_up (profile, title, season, episode, finished_at) VALUES (?, ?, ?, ?, ?)');
	const hide = db.prepare(`
		INSERT INTO continue_hidden (profile, title, type, hidden_at) VALUES (?, ?, 'tv', datetime('now'))
		ON CONFLICT (profile, title, type) DO UPDATE SET hidden_at = excluded.hidden_at
	`);
	for (const row of hidden) {
		if (row.finished) caughtUp.run(row.profile, row.title, row.season, row.episode, row.updatedAt);
		else hide.run(row.profile, row.title);
	}
});

/**
 * Live TV's saved channels and games, and the channels watched lately, for each profile
 * (src/routes/api/live). `kind`: 'channel', 'game' or 'recent'; `key`: the channel's number or
 * the game's id. A saved game keeps its details in `data` (as JSON), so it still shows once it's
 * gone from the schedule; it's dropped a few hours after it ends.
 */
db.exec(`
	CREATE TABLE IF NOT EXISTS live_saved (
		profile INTEGER NOT NULL,
		kind TEXT NOT NULL,
		key TEXT NOT NULL,
		name TEXT NOT NULL,
		data TEXT,
		saved_at TEXT NOT NULL DEFAULT (datetime('now')),
		PRIMARY KEY (profile, kind, key)
	)
`);

// TV shows (Jeopardy!, SNL…) became their own kind on Live TV, after some profiles had picked
// their sports: added to those picks once, so the shows aren't hidden from them unasked.
once('live-sports-tv-shows', () => {
	const rows = db.prepare("SELECT profile, data FROM live_saved WHERE kind = 'sports' AND key = 'picked'").all() as { profile: number; data: string | null }[];
	const update = db.prepare("UPDATE live_saved SET data = ? WHERE profile = ? AND kind = 'sports' AND key = 'picked'");
	for (const row of rows) {
		try {
			const picked = JSON.parse(row.data ?? '[]');
			if (Array.isArray(picked) && picked.length && !picked.includes('tv')) update.run(JSON.stringify([...picked, 'tv']), row.profile);
		} catch {}
	}
});

/**
 * Downloads (downloads.ts): films, episodes and replays kept on this computer to watch without
 * the internet, or to save onto a phone. One folder each in downloads/, named by id. `state`:
 * waiting, downloading, finishing (made into one file), done, failed.
 */
db.exec(`
	CREATE TABLE IF NOT EXISTS downloads (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		kind TEXT NOT NULL,
		title TEXT NOT NULL,
		year TEXT NOT NULL DEFAULT '',
		season INTEGER NOT NULL DEFAULT 0,
		episode INTEGER NOT NULL DEFAULT 0,
		episode_name TEXT,
		poster TEXT,
		source TEXT NOT NULL DEFAULT '',
		share_key TEXT,
		fid INTEGER,
		replay_id TEXT,
		replay_version INTEGER,
		height INTEGER NOT NULL DEFAULT 0,
		audio TEXT NOT NULL DEFAULT '',
		has_subtitles INTEGER NOT NULL DEFAULT 0,
		state TEXT NOT NULL DEFAULT 'waiting',
		done_pieces INTEGER NOT NULL DEFAULT 0,
		total_pieces INTEGER NOT NULL DEFAULT 0,
		bytes INTEGER NOT NULL DEFAULT 0,
		estimate INTEGER NOT NULL DEFAULT 0,
		error TEXT,
		place REAL NOT NULL DEFAULT 0,
		duration REAL NOT NULL DEFAULT 0,
		added_at TEXT NOT NULL DEFAULT (datetime('now')),
		finished_at TEXT
	)
`);

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
