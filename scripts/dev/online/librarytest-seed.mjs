// Seeds two EMPTY test libraries for librarytest.mjs (never the real library):
//   node scripts/dev/online/librarytest-seed.mjs <library.db> a|b
// Sets the local meeting point (http://127.0.0.1:8799) and a few titles that overlap on purpose.
import { DatabaseSync } from 'node:sqlite';
const [, , file, who] = process.argv;
if (!file || !/library\.db$/.test(file) || /AppData[\\/]Roaming[\\/]Catalog/i.test(file)) throw new Error('A test library, please');
const db = new DatabaseSync(file);
const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
set.run('setupDone', '1');
set.run('onlineUrl', 'http://127.0.0.1:8799');
const cat = (slug) => db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug)?.id ?? db.prepare('SELECT id FROM categories LIMIT 1').get().id;
const add = db.prepare('INSERT INTO entries (category_id, title, year, status, rating, notes, source, source_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const row = (slug, title, year, status, rating, notes, source, id, updated) => add.run(cat(slug), title, year, status, rating, notes, source, id, updated, updated);
db.prepare("INSERT INTO profiles (name, color) VALUES ('Dad', '#5b8def')").run();
const dad = db.prepare("SELECT id FROM profiles WHERE name = 'Dad'").get().id;
const dadTitle = db.prepare("INSERT INTO profile_titles (profile, source, source_id, title, year, category, status, updated_at) VALUES (?, 'tmdb', ?, ?, ?, 'movies', ?, '2026-11-01 10:00:00')");
if (who === 'a') {
	row('movies', 'Fight Club', 1999, 'completed', 9, 'Seen it twice', 'tmdb', 'movie:550', '2026-11-05T10:00:00.000Z');
	row('tv', 'Breaking Bad', 2008, 'caught_up', 8.5, '', 'tmdb', 'tv:1396', '2026-11-05T10:00:00.000Z');
	row('anime', 'Cowboy Bebop', 1998, 'completed', null, '', 'anilist', '1', '2026-11-05T10:00:00.000Z');
	row('movies', 'Home Video', 2020, 'completed', null, '', 'manual', null, '2026-11-05T10:00:00.000Z');
	row('movies', 'Long Review Film', 2001, 'completed', 7, 'x'.repeat(30_000), 'tmdb', 'movie:111', '2026-11-05T10:00:00.000Z');
	dadTitle.run(dad, 'movie:550', 'Fight Club', 1999, 'completed');
} else {
	row('movies', 'Fight Club', 1999, 'completed', 7, '', 'tmdb', 'movie:550', '2026-10-01 10:00:00');
	row('movies', 'Dune', 2021, 'planned', null, '', 'tmdb', 'movie:438631', '2026-11-10T10:00:00.000Z');
	row('anime', 'Cowboy Bebop', 1998, 'watching', null, '', 'tmdb', 'tv:30991', '2026-10-01T10:00:00.000Z');
	row('movies', 'Long Review Film', 2001, 'completed', 6, 'short on B', 'tmdb', 'movie:111', '2026-10-01T10:00:00.000Z');
	dadTitle.run(dad, 'movie:438631', 'Dune', 2021, 'planned');
}
console.log(who, 'dad profile', dad, db.prepare('SELECT count(*) AS n FROM entries').get());
