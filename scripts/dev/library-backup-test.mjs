// node scripts/dev/library-backup-test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = mkdtempSync(join(homedir(), '.catalog-library-test-'));
const source = join(dir, 'source.db');
const backups = join(dir, 'backups');
const json = join(backups, 'library.json');
const dest = join(dir, 'restored.db');
const env = { ...process.env, CATALOG_DB: source };
const run = (script, ...args) => spawnSync(process.execPath, [`scripts/${script}.mjs`, ...args], { env, encoding: 'utf8' });
const success = (result) => assert.equal(result.status, 0, result.stderr);
const check = (name, test) => {
	try { test(); console.log(`PASS ${name}`); }
	catch (err) { console.error(`FAIL ${name}: ${err.message}`); process.exitCode = 1; }
};

try {
	const writer = new DatabaseSync(source);
	writer.exec(`
		PRAGMA journal_mode = WAL;
		CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, slug TEXT);
		CREATE TABLE entries (id INTEGER PRIMARY KEY, category_id INTEGER, title TEXT, created_at TEXT, updated_at TEXT);
		CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT);
		CREATE TABLE entry_tags (entry_id INTEGER, tag_id INTEGER);
		CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT, body TEXT, created_at TEXT, updated_at TEXT);
		CREATE TABLE people (id INTEGER PRIMARY KEY, source_id TEXT, name TEXT);
		CREATE TABLE entry_cast (entry_id INTEGER, person_id INTEGER, ord INTEGER);
		CREATE TABLE note_versions (id INTEGER PRIMARY KEY, note_id INTEGER, title TEXT, body TEXT, saved_at TEXT);
		CREATE TABLE my_watch_orders (id TEXT PRIMARY KEY, name TEXT, added_at TEXT);
		CREATE TABLE settings (key TEXT, value TEXT);
		INSERT INTO categories VALUES (1, 'Films', 'movies');
		INSERT INTO entries VALUES (1, 1, 'Before', '2026-01-01', '2026-01-01');
		INSERT INTO notes VALUES (1, 'A note', 'Current body', '2026-01-01', '2026-01-01');
		INSERT INTO note_versions VALUES (1, 1, 'A note', 'Earlier body', '2026-01-01');
		INSERT INTO my_watch_orders VALUES ('mcu', 'Marvel', '2026-01-01'), ('collection-99', 'Fixture films', '2026-01-02');
		INSERT INTO settings VALUES ('key', 'fixture-only');
		PRAGMA wal_checkpoint(TRUNCATE);
	`);
	const reader = new DatabaseSync(source);
	reader.exec('BEGIN');
	reader.prepare('SELECT * FROM entries').get();
	writer.exec("UPDATE entries SET title = 'Latest commit' WHERE id = 1");
	try { success(run('backup')); } finally { reader.close(); writer.close(); }

	const backup = JSON.parse(readFileSync(json, 'utf8'));
	check('database snapshot includes commits still in WAL', () => {
		const snapshots = join(backups, 'snapshots');
		const snapshot = new DatabaseSync(join(snapshots, readdirSync(snapshots)[0]));
		try {
			assert.equal(snapshot.prepare('SELECT title FROM entries').get().title, 'Latest commit');
			assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
		} finally { snapshot.close(); }
	});
	check('readable backup includes note history but not settings', () => {
		assert.equal(backup.entries[0].title, 'Latest commit');
		assert.equal(backup.noteVersions?.[0]?.body, 'Earlier body');
		assert.equal('settings' in backup, false);
	});
	check('a downloaded backup can be previewed and restored without renaming it', () => {
		const download = join(dir, 'catalog-download.json');
		writeFileSync(download, JSON.stringify({ ...backup, entries: [{ ...backup.entries[0], title: 'From download' }] }));
		const target = join(dir, 'from-download.db');
		success(run('restore', '--from', download, '--to', target));
		assert.equal(readdirSync(dir).includes('from-download.db'), false);
		success(run('restore', '--write', '--from', download, '--to', target));
		const restored = new DatabaseSync(target, { readOnly: true });
		try {
			assert.equal(restored.prepare('SELECT title FROM entries').get().title, 'From download');
			assert.equal(restored.prepare('SELECT body FROM note_versions').get().body, 'Earlier body');
		} finally { restored.close(); }
	});
	check('saved franchise watch lists round-trip through JSON in their original order', () => {
		const expected = [
			{ id: 'mcu', name: 'Marvel', added_at: '2026-01-01' },
			{ id: 'collection-99', name: 'Fixture films', added_at: '2026-01-02' }
		];
		assert.deepEqual(backup.watchOrders, expected);
		success(run('restore', '--write', '--to', dest));
		const restored = new DatabaseSync(dest, { readOnly: true });
		try {
			const orders = restored.prepare('SELECT * FROM my_watch_orders ORDER BY added_at').all();
			assert.deepEqual(orders.map(order => ({ ...order })), expected);
		} finally { restored.close(); }
	});
	check('failed restore leaves the original library untouched', () => {
		success(run('restore', '--write', '--to', dest));
		const before = readFileSync(dest);
		writeFileSync(json, JSON.stringify({ ...backup, entries: [...backup.entries, { ...backup.entries[0], id: 2, category_id: 999 }] }));
		assert.notEqual(run('restore', '--write', '--to', dest).status, 0);
		assert.ok(readFileSync(dest).equals(before), 'original database bytes changed');
	});
	check('older backups still restore and an open WAL library is not replaced', () => {
		const { noteVersions, watchOrders, ...oldBackup } = backup;
		writeFileSync(json, JSON.stringify(oldBackup));
		success(run('restore', '--write', '--to', dest));
		const restored = new DatabaseSync(dest);
		try {
			assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM my_watch_orders').get().count, 0);
			restored.exec("PRAGMA journal_mode = WAL; UPDATE entries SET title = 'Open library edit'");
			const refused = run('restore', '--write', '--to', dest);
			assert.notEqual(refused.status, 0);
			assert.match(refused.stderr, /Close Catalog/);
			assert.equal(restored.prepare('SELECT title FROM entries').get().title, 'Open library edit');
		} finally { restored.close(); }
	});
} finally {
	rmSync(dir, { recursive: true, force: true });
}
