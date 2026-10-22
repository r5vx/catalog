/**
 * TMDB's ids for a name (films and shows), with the key from a test copy of the library.
 *
 *   node scripts/dev/tmdbsearch.mjs "<copy of library.db>" "Primetime"
 */
import { DatabaseSync } from 'node:sqlite';
import { notLive } from './notLive.mjs';
const [db, q] = process.argv.slice(2);
const key = new DatabaseSync(notLive(db), { readOnly: true }).prepare("select value from settings where key='tmdbApiKey'").get()?.value;
const bearer = key.length > 40;
const r = await (await fetch(`https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(q)}${bearer ? '' : `&api_key=${key}`}`, bearer ? { headers: { Authorization: `Bearer ${key}` } } : {})).json();
for (const x of r.results.slice(0, 6)) console.log(x.media_type, x.id, x.title ?? x.name, x.release_date ?? x.first_air_date, x.vote_count);
