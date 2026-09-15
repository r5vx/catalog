/**
 * Backs up your library. Run by hand with `npm run backup`, or nightly by the
 * scheduled task.
 *
 * Three layers, in order of how much they protect you:
 *
 *   1. library.json   — a readable export. Every night's version is kept in git
 *                       history, so you can recover a rating you overwrote six
 *                       months ago, and you could read it in Notepad in 20 years.
 *   2. snapshots/*.db — real database copies. This is the FAST restore: drop one
 *                       back and you're running again in seconds.
 *   3. git push       — the offsite copy, for when the PC itself is gone.
 *                       Only runs once you've set up a remote (see below).
 */
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import {
	mkdirSync,
	copyFileSync,
	writeFileSync,
	existsSync,
	readdirSync,
	unlinkSync,
	statSync,
	cpSync
} from 'node:fs';
import { join } from 'node:path';
import { dbPath, backupDir } from './paths.mjs';

const KEEP_SNAPSHOTS = 14;

const source = dbPath();
const dest = backupDir();
const snapshotDir = join(dest, 'snapshots');

if (!existsSync(source)) {
	console.error(`No library found at ${source}. Nothing to back up.`);
	process.exit(1);
}

mkdirSync(snapshotDir, { recursive: true });

/* ------------------------------------------------------- 1. readable export */

const db = new DatabaseSync(source);

// Fold the write-ahead log back into the main file so the copy we take below is
// a complete, self-contained database.
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');

const rows = (sql) => db.prepare(sql).all().map((row) => ({ ...row }));

const snapshot = {
	exportedAt: new Date().toISOString(),
	formatVersion: 1,
	categories: rows('SELECT * FROM categories ORDER BY id'),
	entries: rows('SELECT * FROM entries ORDER BY id'),
	tags: rows('SELECT * FROM tags ORDER BY id'),
	entryTags: rows('SELECT * FROM entry_tags ORDER BY entry_id, tag_id'),
	notes: rows('SELECT * FROM notes ORDER BY id'),
	people: rows('SELECT * FROM people ORDER BY id'),
	entryCast: rows('SELECT * FROM entry_cast ORDER BY entry_id, ord')
	// NOTE: the `settings` table is deliberately NOT exported — it holds your
	// TMDB key, and this file gets pushed to GitHub.
};

db.close();

writeFileSync(join(dest, 'library.json'), JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

/* ----------------------------------------------------- 2. database snapshot */

// Note images are files, not rows, so they're copied alongside the snapshot.
const mediaSrc = join(source, '..', 'media');
if (existsSync(mediaSrc)) {
	cpSync(mediaSrc, join(dest, 'media'), { recursive: true });
	console.log('Copied note images');
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
copyFileSync(source, join(snapshotDir, `library-${stamp}.db`));

// Keep the most recent few, drop the rest.
const snapshots = readdirSync(snapshotDir)
	.filter((name) => name.endsWith('.db'))
	.map((name) => ({ name, at: statSync(join(snapshotDir, name)).mtimeMs }))
	.sort((a, b) => b.at - a.at);

for (const old of snapshots.slice(KEEP_SNAPSHOTS)) {
	unlinkSync(join(snapshotDir, old.name));
}

/* ------------------------------------------------------------ a short guide */

writeFileSync(
	join(dest, 'README.md'),
	`# Catalog backups

Written automatically. You should not need to edit anything in here.

- **library.json** — everything you've watched, as readable text. This is the
  file that goes to GitHub, and its history is your undo button.
- **snapshots/** — the last ${KEEP_SNAPSHOTS} copies of the database itself.
  To restore: close Catalog, copy one over \`${source}\`, reopen.

To restore from library.json instead, run \`npm run restore\` in the project
folder.
`,
	'utf8'
);

// Snapshots are large and binary; git only ever sees the readable export.
writeFileSync(join(dest, '.gitignore'), 'snapshots/\n', 'utf8');

console.log(`Exported ${snapshot.entries.length} entries to ${join(dest, 'library.json')}`);
console.log(`Snapshot saved (keeping the last ${KEEP_SNAPSHOTS})`);

/* --------------------------------------------------------- 3. offsite, git */

const git = (...args) =>
	execFileSync('git', args, { cwd: dest, encoding: 'utf8', stdio: 'pipe' }).trim();

if (!existsSync(join(dest, '.git'))) {
	console.log('\nOffsite backup is not set up yet — local backups are working.');
	console.log('To turn it on, see "Backups" in the project README.');
	process.exit(0);
}

try {
	const remotes = git('remote');
	if (!remotes) {
		console.log('\nNo git remote set, so nothing was pushed. Local backups are working.');
		process.exit(0);
	}

	git('add', '-A');

	// Nothing changed since the last run? Then there is nothing to commit.
	const pending = git('status', '--porcelain');
	if (!pending) {
		console.log('\nNo changes since the last backup.');
		process.exit(0);
	}

	git('commit', '-m', `Backup ${snapshot.exportedAt.slice(0, 16).replace('T', ' ')}`);
	git('push');
	console.log('\nPushed to your private repo.');
} catch (error) {
	// A failed push must never look like a successful backup.
	console.error('\nLocal backup succeeded, but the push failed:');
	console.error(String(error.stderr || error.message).trim());
	process.exit(1);
}
