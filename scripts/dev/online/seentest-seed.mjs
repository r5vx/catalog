import { DatabaseSync } from 'node:sqlite';
const [, , file, who] = process.argv;
const db = new DatabaseSync(file);
const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
set.run('setupDone', '1');
set.run('onlineUrl', 'http://127.0.0.1:8799');
const cat = (slug) => db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug)?.id ?? db.prepare('SELECT id FROM categories LIMIT 1').get().id;
const add = db.prepare("INSERT INTO entries (category_id, title, year, status, rating, source, source_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))");
if (who === 'a') {
  add.run(cat('movies'), 'Fight Club', 1999, 'completed', 9, 'tmdb', 'movie:550');
  add.run(cat('tv'), 'Breaking Bad', 2008, 'caught_up', 8.5, 'tmdb', 'tv:1396');
  add.run(cat('anime'), 'Cowboy Bebop', 1998, 'completed', null, 'anilist', '1');
  add.run(cat('movies'), 'Dune', 2021, 'planned', null, 'tmdb', 'movie:438631');
  // a second profile on A, with its own list
  db.prepare("INSERT INTO profiles (name, color) VALUES ('Dad', '#5b8def')").run();
  const dad = db.prepare("SELECT id FROM profiles WHERE name = 'Dad'").get().id;
  db.prepare("INSERT INTO profile_titles (profile, source, source_id, title, year, category, status) VALUES (?, 'tmdb', 'movie:550', 'Fight Club', 1999, 'movies', 'completed')").run(dad);
  console.log('dad profile', dad);
}
console.log(db.prepare('SELECT count(*) AS n FROM entries').get(), db.prepare('SELECT slug FROM categories').all().map((c) => c.slug).join(','));
