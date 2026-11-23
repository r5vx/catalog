// node scripts/dev/this-week-test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

let serial = 0;
async function moduleFrom(source, dependencies) {
	globalThis.weekTest = dependencies;
	const code = `const {${Object.keys(dependencies).join(',')}} = globalThis.weekTest;\n` + source.replace(/^import[\s\S]*?;\n/gm, '');
	const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
	return import(`data:text/javascript;base64,${Buffer.from(compiled + `\n// ${serial++}`).toString('base64')}`);
}
const load = (path, dependencies) => moduleFrom(readFileSync(path, 'utf8'), dependencies);
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE watch_progress(profile INTEGER, title TEXT, type TEXT, current_time REAL);
	INSERT INTO watch_progress VALUES (0, ' ÉLÉPHANT ', 'movie', 1), (0, 'Unplayed', 'movie', 0),
	(1, 'Phone film', 'movie', 10), (0, 'An episode', 'tv', 10);`);
let profile = 0;
const queries = readFileSync('src/lib/server/db/queries.ts', 'utf8');
const query = queries.slice(queries.indexOf('export function playedFilmTitles()'), queries.indexOf('/** The whole library, most recently touched first'));
const progress = await moduleFrom(query, { db, currentProfile: () => profile, MAIN_PROFILE: 0 });
assert.deepEqual([...progress.playedFilmTitles()], ['éléphant']);
profile = 1;
assert.deepEqual([...progress.playedFilmTitles()], ['phone film']);
db.exec('DELETE FROM watch_progress');
assert.equal(progress.playedFilmTitles().size, 0);
db.exec(`CREATE TABLE entries(source TEXT, source_id TEXT, created_at TEXT);
	INSERT INTO entries VALUES ('tmdb', 'movie:1', '2026-11-15T23:59:59Z'),
	('tmdb', 'movie:2', '2026-11-16T00:00:00Z'), ('tmdb', 'tv:3', '2026-01-01');`);
profile = 0;
assert.deepEqual([...progress.olderLibraryFilmKeys(Date.parse('2026-11-16T00:00:00Z'))], ['tmdb:movie:1']);
profile = 1; assert.equal(progress.olderLibraryFilmKeys(Date.now()).size, 0);
db.exec(`ALTER TABLE entries ADD COLUMN id INTEGER; ALTER TABLE entries ADD COLUMN title TEXT;
	ALTER TABLE entries ADD COLUMN status TEXT; ALTER TABLE entries ADD COLUMN updated_at TEXT;
	INSERT INTO entries(source, source_id, id, title, status, updated_at) VALUES
	('tmdb', 'tv:45790', 1, 'JoJo', 'planned', '2026-11-22'),
	('tmdb', 'tv:220542', 2, 'Apothecary Diaries', 'planned', '2026-11-22'),
	('tmdb', 'tv:73223', 3, 'Black Clover', 'planned', '2026-11-22'),
	('tmdb', 'tv:999', 4, 'Dropped', 'dropped', '2026-11-22');`);
const followedStart = queries.indexOf('export function followedShows()');
const following = await moduleFrom(queries.slice(followedStart, queries.indexOf('\n}', followedStart) + 2), { db });
assert.deepEqual(new Set(following.followedShows().map((show) => show.tmdb)), new Set([45790, 220542, 73223]));
db.close();
console.log('PASS progress: played films only, Unicode title matching, profile isolation, empty');

let cache = new Map(), planned = [], followed = [], requested = [], discover = [], replies = new Map();
const now = Date.now();
const week = await load('src/lib/server/thisWeek.ts', {
	getOrderCache: (key) => cache.get(key), saveOrderCache: (key, value, at) => cache.set(key, { value, at }),
	followedShows: () => followed, tvLibrary: () => planned, watchRegion: () => 'US', currentProfile: () => profile, MAIN_PROFILE: 0,
	anilistResting: () => false, anilistSaidWait: () => {},
	tmdbGet: async (path) => { requested.push(path); return path === '/discover/movie' ? { results: discover } : replies.get(path) ?? null; }
});
const window = week.weekWindow();
const date = (offset) => { const d = new Date(window.today + 'T12:00:00'); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
const dates = (offset, country = 'US') => ({ results: [{ iso_3166_1: country, release_dates: [{ type: 4, release_date: date(offset) }] }] });
const film = (id) => ({ id, title: 'Film ' + id, poster_path: '/poster.png', release_date: window.today });
discover = [film(1), film(2)];
replies.set('/movie/1/release_dates', dates(0));
replies.set('/movie/2/release_dates', { results: [...dates(0).results, ...dates(-30, 'JP').results] });
assert.deepEqual((await week.newFilms('4|5')).map((item) => item.key), ['tmdb:movie:1']);
cache.clear(); requested = []; discover = Array.from({ length: 25 }, (_, i) => film(i + 1));
for (let i = 1; i <= 25; i++) replies.set(`/movie/${i}/release_dates`, dates(0));
assert.equal((await week.newFilms('4|5')).length, 20);
assert.equal(requested.filter((path) => path.includes('release_dates')).length, 20);
assert.ok(!requested.includes('/movie/21/release_dates'));
console.log('PASS dates: first worldwide release excludes earlier foreign release; cap drops unchecked films');
const finalKey = `week-films-first|4|5|US|${window.today}`;
cache.set(finalKey, { value: [{ key: 'unverified' }], at: now - 7 * 3600000 });
cache.set('week-film-dates|1', { value: dates(0), at: now - 7 * 3600000 });
discover = [film(1)]; replies.clear();
assert.equal(await week.newFilms('4|5'), null);
assert.equal(cache.get(finalKey).at, now - 7 * 3600000);
planned = [1, 2].map((id) => ({ id, title: 'Film ' + id, source: 'tmdb', sourceId: 'movie:' + id, status: 'planned', year: 2026 }));
cache.clear(); cache.set('week-film-dates|1', { value: dates(0), at: now });
let result = await week.fromWatchList();
assert.equal(result.failed, true); assert.deepEqual(result.items.map((item) => item.key), ['tmdb:movie:1']);
planned = []; cache.clear(); discover = [];
assert.deepEqual(await week.fromWatchList(), { items: [], failed: false });
assert.deepEqual(await week.newFilms('4|5'), []);
console.log('PASS dates: failed refresh never falls back to stale films/dates; partial watch list and empty');

profile = 0;
followed = [{ id: 1, title: "JoJo's Bizarre Adventure", tmdb: 45790 },
	{ id: 2, title: 'The Apothecary Diaries', tmdb: 220542 }, { id: 3, title: 'Black Clover', tmdb: 73223 }];
planned = followed.map((show) => ({ ...show, source: 'tmdb', sourceId: `tv:${show.tmdb}`, status: 'planned' }));
const episode = (offset, number) => ({ air_date: date(offset), season_number: 1, episode_number: number, name: '', overview: '', still_path: null });
for (const show of [...followed, { tmdb: 999 }]) replies.set(`/tv/${show.tmdb}`, {
	poster_path: null, backdrop_path: null, popularity: 10, last_episode_to_air: episode(-1, 1), next_episode_to_air: episode(5, 2)
});
const yours = await week.yourShows();
assert.equal(yours.out.length, 3); assert.equal(yours.soon.length, 3);
requested = [];
assert.deepEqual(await week.fromWatchList(), { items: [], failed: false });
assert.equal(requested.length, 0);
planned.push({ id: 4, title: 'Unfollowed planned show', source: 'tmdb', sourceId: 'tv:999', status: 'planned' },
	{ id: 5, title: 'Planned film', source: 'tmdb', sourceId: 'movie:5', status: 'planned' });
replies.set('/movie/5/release_dates', dates(0));
result = await week.fromWatchList();
assert.deepEqual(new Set(result.items.map((item) => item.key)), new Set(['tmdb:tv:999:1:1', 'tmdb:tv:999:1:2', 'tmdb:movie:5']));
cache.clear(); replies.delete('/tv/999');
result = await week.fromWatchList();
assert.equal(result.failed, true); assert.deepEqual(result.items.map((item) => item.key), ['tmdb:movie:5']);
profile = 88; planned = [{ id: 1, title: 'Phone planned show', source: 'tmdb', sourceId: 'tv:45790', status: 'planned' }];
assert.equal((await week.fromWatchList()).items.length, 2);
planned = []; followed = [];
assert.deepEqual(await week.fromWatchList(), { items: [], failed: false });
console.log('PASS watch-list overlap: JoJo/Apothecary/Black Clover keep six episodes in Your shows only; unfollowed shows and films retained; failures, empty and phone isolation');

let ready = true, library = [], played = new Set(), older = new Set(), fail = false;
const items = [1, 2, 3, 4].map((id) => ({ key: `tmdb:movie:${id}`, title: 'Film ' + id, href: '/title/tmdb/movie%3A' + id }));
const loader = await load('src/lib/server/thisWeekPage.ts', {
	weekWindow: week.weekWindow, animeThisWeek: async () => ({ items: [], failed: false }),
	newFilms: async () => fail ? null : items, newShows: async () => [], yourShows: async () => ({ out: [], soon: [], failed: false }),
	fromWatchList: async () => ({ items, failed: fail }), existingSourceKeysWithIds: () => ({ 'tmdb:movie:4': 4 }),
	playedFilmTitles: () => new Set(played), olderLibraryFilmKeys: () => new Set(older), tvLibrary: () => library, currentProfile: () => profile, MAIN_PROFILE: 0,
	hasTmdbKey: () => ready, withBack: (href) => href, titleHref: (source, id) => `/tv/title/${source}/${id}`,
	continueWatchingWithPosters: async () => [], tvTitleLink: async () => null
});
profile = 0;
library = [{ source: 'tmdb', sourceId: 'movie:1', title: 'Renamed film', status: 'completed', category: 'movies' },
	{ source: 'manual', title: 'Film 2', status: 'watching', category: 'movies' }];
played = new Set(['film 3']);
for (const tv of [false, true]) {
	const data = await loader.loadThisWeek(tv);
	for (const list of [data.lists.streaming, data.watchList]) {
		const listResult = await list;
		assert.deepEqual(listResult.items.map((item) => item.key), ['tmdb:movie:4']);
		assert.equal(listResult.items[0].owned, true);
	}
	assert.equal((await data.lists.cinemas).items.length, 4);
}
library = []; played.clear(); older = new Set(['tmdb:movie:1']);
result = await loader.loadThisWeek();
assert.deepEqual((await result.lists.streaming).items.map((item) => item.key), ['tmdb:movie:2', 'tmdb:movie:3', 'tmdb:movie:4']);
assert.deepEqual((await result.watchList).items.map((item) => item.key), ['tmdb:movie:2', 'tmdb:movie:3', 'tmdb:movie:4']);
older.clear(); profile = 88;
assert.equal((await (await loader.loadThisWeek()).lists.streaming).items.length, 4);
ready = false;
result = await loader.loadThisWeek();
assert.deepEqual(await result.lists.streaming, { items: [], failed: false });
assert.deepEqual(await result.watchList, { items: [], failed: false });
ready = true; fail = true;
result = await loader.loadThisWeek();
assert.equal((await result.lists.streaming).failed, true);
assert.equal((await result.watchList).failed, true);
console.log('PASS loader: desktop/TV status and progress exclusions, unwatched owned retained, cinemas unchanged, profile isolation, no key, failures');

let version = '4.6.1', used = 1, notes = [{ version, title: 'Release', changes: [{ kind: 'new', items: ['One line'] }] }];
const popup = await load('src/lib/server/whatsNewCard.ts', { appVersion: () => version, whatsNew: () => notes,
	db: { prepare: () => ({ get: () => ({ n: used }) }) } });
assert.equal(popup.whatsNewCard('4.6.0').version, version);
assert.equal(popup.whatsNewCard(version), null);
assert.equal(popup.whatsNewCard().version, version);
let receipt;
popup.whatsNewSeen({ set: (...args) => { receipt = args; } });
assert.equal(receipt[1], version); assert.equal(receipt[2].path, '/');
used = 0; assert.equal(popup.whatsNewCard(), null);
notes = [{ version, title: 'Fixes', changes: [{ kind: 'fixed', items: ['A fix'] }] }];
assert.deepEqual(popup.whatsNewCard('4.6.0').lines, ['A fix']);
used = 1; notes = []; assert.equal(popup.whatsNewCard(), null);
version = 'invalid'; assert.equal(popup.whatsNewCard(), null);
console.log('PASS popup: each full version, independent receipt, dismiss cookie, new install, missing notes and invalid version');
