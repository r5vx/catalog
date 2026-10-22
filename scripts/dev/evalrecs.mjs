/**
 * "More like this" for a spread of titles, from the test server (port 5199), after forgetting
 * the kept answers in the test copy so each is worked out again with the current scoring.
 *
 *   node scripts/dev/evalrecs.mjs "<copy of library.db>" "movie|The Marvels|2023" "tv|Breaking Bad|2008" ...
 *
 * Judge by a broad spread (popular, old, niche, new, shows), never one title.
 */
import { DatabaseSync } from 'node:sqlite';
import { notLive } from './notLive.mjs';

const [dbPath, ...specs] = process.argv.slice(2);
const db = new DatabaseSync(notLive(dbPath));
const key = db.prepare("select value from settings where key='tmdbApiKey'").get().value;
db.prepare("delete from watch_order_cache where key like 'recs%|%'").run();
const tmdb = async (path, q = {}) => (await fetch(`https://api.themoviedb.org/3/${path}?${new URLSearchParams({ api_key: key, ...q })}`)).json();
for (const spec of specs) {
	const [type, name, year] = spec.split('|');
	const found = await tmdb(`search/${type}`, { query: name, ...(year ? (type === 'movie' ? { year } : { first_air_date_year: year }) : {}) });
	const hit = found.results?.[0];
	if (!hit) {
		console.log(`${name}: not found`);
		continue;
	}
	const list = await (await fetch(`http://localhost:5199/api/recommendations?source=tmdb&id=${type}:${hit.id}`)).json();
	const row = list.filter((x) => !x.more).slice(0, 10);
	console.log(`${hit.title ?? hit.name} (${(hit.release_date ?? hit.first_air_date ?? '').slice(0, 4)}):\n  ${row.map((x) => x.title + (x.why ? ` [${x.why}]` : '') + (x.watched ? ' (watched)' : '')).join(' · ')}`);
}
