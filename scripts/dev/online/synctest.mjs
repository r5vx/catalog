// The 2026-11-14 night round, through two test Catalogs on 5297 (A) and 5301 (B) and the meeting
// point run locally (cloud/README.md): sync on by default, removals, Continue Watching both ways
// (farther place wins for an episode), who's in a room, friend requests and suggestions, the feed,
// the Friends page and the TMDB banner. Libraries: two empty test ones seeded with
// librarytest-seed.mjs (never the real library). Takes ~2 minutes (the feed is sent a minute in).
//   node scripts/dev/online/synctest.mjs <A's library.db> <B's library.db>
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const A = 'http://127.0.0.1:5297', B = 'http://127.0.0.1:5301';
const [, , fileA, fileB] = process.argv;
for (const f of [fileA, fileB]) if (!f || /AppData[\\/]Roaming[\\/]Catalog/i.test(f)) throw new Error('Two test libraries, please');
let failed = 0;
const check = (name, ok, extra = '') => {
	if (!ok) failed++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};
// Dad (profile 1), as a TV asks.
const DAD = { 'User-Agent': 'CatalogTV/1.0 (test)', Cookie: 'catalog_profile=1' };
async function ask(base, path, method = 'GET', body, headers = {}) {
	const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
	return { status: r.status, data: await r.json().catch(() => null) };
}
const online = (base, body, headers) => ask(base, '/api/online', 'POST', body, headers).then((r) => r.data);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = (file) => new DatabaseSync(file);
const one = (file, sql, ...args) => {
	const db = open(file);
	try {
		return db.prepare(sql).get(...args);
	} finally {
		db.close();
	}
};
const run = (file, sql, ...args) => {
	const db = open(file);
	try {
		db.prepare(sql).run(...args);
	} finally {
		db.close();
	}
};
const hasEntry = (file, title) => Boolean(one(file, 'SELECT 1 AS x FROM entries WHERE title = ?', title));

// The TMDB banner: test libraries have no key.
const home = await fetch(A + '/').then((r) => r.text());
check('no TMDB key: the banner says so', home.includes('Catalog needs a TMDB key.'));

// (The old maroon accent moving to the pink, settings.ts, is checked on a copy set up like an old
// install, maroon saved and the fix not yet run: a fresh test library records the fix on its first start.)

// Online; the owner is one person on both computers. Dad is a different person on each (not linked).
check('joining needs a name', (await ask(A, '/api/online', 'POST', { action: 'connect', join: 'TESTJOIN' })).status === 400);
for (const base of [A, B]) check(`${base} joins`, (await ask(base, '/api/online', 'POST', { action: 'connect', join: 'TESTJOIN', name: base === A ? 'Sam' : 'Sam too' })).status === 200);
check('the name typed is the name online', (await ask(A, '/api/online')).data?.account?.name === 'Sam');
const code = (await ask(A, '/api/online/c/link/code', 'POST', {})).data?.code;
check('B joins A with a link code', (await ask(B, '/api/online/c/link/join', 'POST', { code })).status === 200);

// 2. On by default, nothing ticked.
const sA = (await ask(A, '/api/online')).data, sB = (await ask(B, '/api/online')).data;
check('progress sync on by default', sA?.sync === true && sB?.sync === true);
check('library sync on by default', sA?.library?.on === true && sB?.library?.on === true);
check('removals on by default', sA?.removals === true && sB?.removals === true);
check("Dad's are on too", (await ask(A, '/api/online', 'GET', undefined, DAD)).data?.library?.on === true);

// Library in step: A's titles reach B.
await online(A, { action: 'libraryNow' });
let rB = await online(B, { action: 'libraryNow' });
await online(A, { action: 'libraryNow' });
check('B has A’s Breaking Bad', hasEntry(fileB, 'Breaking Bad'), JSON.stringify(rB));
check('A has B’s Dune', hasEntry(fileA, 'Dune'));

// 1. Removed on A (by hand): gone from B, a backup made first.
const bb = one(fileA, "SELECT id FROM entries WHERE title = 'Breaking Bad'").id;
check('A removes Breaking Bad', (await ask(A, '/api/entries', 'DELETE', { id: bb })).status === 200 && !hasEntry(fileA, 'Breaking Bad'));
await online(A, { action: 'libraryNow' });
rB = await online(B, { action: 'libraryNow' });
check('gone from B too', !hasEntry(fileB, 'Breaking Bad'), JSON.stringify(rB));
const backups = join(dirname(fileB), 'backups');
check('B backed up before removing', existsSync(backups) && readdirSync(backups).some((f) => f.startsWith('library-before-sync-removals-0-')));
await online(A, { action: 'libraryNow' });
check('and it stays gone on A (not sent back)', !hasEntry(fileA, 'Breaking Bad'));

// Removals off on B: a title removed on A stays on B.
await online(B, { action: 'removals', on: false });
const dune = one(fileA, "SELECT id FROM entries WHERE title = 'Dune'").id;
await ask(A, '/api/entries', 'DELETE', { id: dune });
await online(A, { action: 'libraryNow' });
await online(B, { action: 'libraryNow' });
check('removals off on B: Dune stays on B', hasEntry(fileB, 'Dune'));
await online(B, { action: 'removals', on: true });

// Added again on A after its removal: back on B (newer wins).
await ask(A, '/api/online', 'POST', { action: 'libraryNow' });
run(fileA, "INSERT INTO entries (category_id, title, year, status, source, source_id, created_at, updated_at) VALUES ((SELECT id FROM categories LIMIT 1), 'Breaking Bad', 2008, 'watching', 'tmdb', 'tv:1396', ?, ?)", new Date().toISOString(), new Date().toISOString());
await online(A, { action: 'libraryNow' });
await online(B, { action: 'libraryNow' });
check('added again on A: back on B', hasEntry(fileB, 'Breaking Bad'));

// 3. Continue Watching both ways. Times as SQLite writes them (UTC).
const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString().slice(0, 19).replace('T', ' ');
const progress = (file, title, type, s, e, place, duration, when) =>
	run(
		file,
		`INSERT INTO watch_progress (profile, title, type, season, episode, "current_time", duration, sub_url, sub_delay, sub_file_name, poster_url, share_key, fid, updated_at)
		 VALUES (0, ?, ?, ?, ?, ?, ?, '', 0, '', '', '', 0, ?)
		 ON CONFLICT (profile, title, type, season, episode) DO UPDATE SET "current_time" = excluded."current_time", duration = excluded.duration, updated_at = excluded.updated_at`,
		title, type, s, e, place, duration, when
	);
const place = (file, title, type, s, e) => one(file, 'SELECT CAST("current_time" AS REAL) AS t FROM watch_progress WHERE profile = 0 AND title = ? AND type = ? AND season = ? AND episode = ?', title, type, s, e)?.t ?? null;
// An episode: farther on A (saved earlier), less far on B (saved later). Both end at the farther.
progress(fileA, 'Breaking Bad', 'tv', 1, 3, 1800, 2800, at(10));
progress(fileB, 'Breaking Bad', 'tv', 1, 3, 600, 2800, at(5));
// A film half on each: A got to 2000, then B carried on to 5000 (later). Both at 5000.
progress(fileA, 'Fight Club', 'movie', 0, 0, 2000, 8340, at(30));
progress(fileB, 'Fight Club', 'movie', 0, 0, 5000, 8340, at(2));
for (let i = 0; i < 3; i++) {
	await online(A, { action: 'syncNow' });
	await online(B, { action: 'syncNow' });
}
check('episode: farther place on A', place(fileA, 'Breaking Bad', 'tv', 1, 3) === 1800, String(place(fileA, 'Breaking Bad', 'tv', 1, 3)));
check('episode: farther place on B too (sent back)', place(fileB, 'Breaking Bad', 'tv', 1, 3) === 1800, String(place(fileB, 'Breaking Bad', 'tv', 1, 3)));
check('film: the later place on both', place(fileA, 'Fight Club', 'movie', 0, 0) === 5000 && place(fileB, 'Fight Club', 'movie', 0, 0) === 5000);
const cw = (await fetch(B + '/').then((r) => r.text())).includes('Fight Club');
check("B's home page lists them (Continue Watching)", cw);

// 5. A room: the owner hosts, Dad on B joins; the host's next look shows him without anything new playing.
const room = (await ask(A, '/api/online/c/rooms', 'POST', { title: 'Fight Club', type: 'movie', year: '1999', playing: false, position: 0 })).data;
check('A starts a room', /^[A-Z0-9]{6}$/.test(room?.code ?? ''));
const ownerId = room?.people?.[0]?.id;
const joined = (await ask(B, `/api/online/c/rooms/${room.code}/join`, 'POST', {}, DAD)).data;
check("Dad on B sees both", joined?.people?.length === 2);
const looked = (await ask(A, `/api/online/c/rooms/${room.code}?rev=${room.rev}&people=${ownerId}`)).data;
check('the host sees Dad join (same rev, new people)', looked?.same === true && looked?.people?.length === 2, JSON.stringify(looked?.people?.map((p) => p.name)));
const quiet = (await ask(A, `/api/online/c/rooms/${room.code}?rev=${room.rev}&people=${looked?.people?.map((p) => p.id).join(',')}`)).data;
check('nothing new: a short answer', quiet?.same === true && !quiet.people);

// Friends: the owner and Dad on A are friends; Dad on A and Dad on B are friends. The owner is
// suggested Dad on B (a friend's friend), asks, Dad on B says yes.
const friendCode = async (base, headers) => (await ask(base, '/api/online/c/friends/code', 'POST', {}, headers)).data?.code;
check('owner + Dad on A', (await ask(A, '/api/online/c/friends/add', 'POST', { code: await friendCode(A) }, DAD)).status === 200);
check('Dad on A + Dad on B', (await ask(B, '/api/online/c/friends/add', 'POST', { code: await friendCode(A, DAD) }, DAD)).status === 200);
let mine = (await ask(A, '/api/online/c/friends')).data;
const dadA = mine?.friends?.find((f) => f);
const suggested = mine?.suggestions?.[0];
check('owner is suggested Dad on B, via Dad on A', mine?.suggestions?.length === 1 && suggested?.via === dadA?.name, JSON.stringify(mine?.suggestions));
const theirs = (await ask(A, `/api/online/c/friends/${dadA.id}/friends`)).data?.friends ?? [];
check("Dad on A's friends: the owner (me) and Dad on B", theirs.length === 2 && theirs.some((p) => p.me) && theirs.some((p) => p.id === suggested?.id));
const stranger = (await ask(B, '/api/online/c/friends/request', 'POST', { to: 'ZZZZZZZZZZZZZZZZ' })).status;
check('a stranger can’t be asked', stranger === 403 || stranger === 400, String(stranger));
check('owner asks Dad on B', (await ask(A, '/api/online/c/friends/request', 'POST', { to: suggested.id })).data?.friends === false);
const dadB = (await ask(B, '/api/online/c/friends', 'GET', undefined, DAD)).data;
check('Dad on B sees the request', dadB?.requests?.length === 1);
check('he says yes', (await ask(B, '/api/online/c/friends/answer', 'POST', { from: dadB.requests[0].id, yes: true }, DAD)).status === 200);
mine = (await ask(A, '/api/online/c/friends')).data;
check('owner and Dad on B are friends now', mine?.friends?.length === 2 && !mine?.suggestions?.length && !(await ask(B, '/api/online/c/friends', 'GET', undefined, DAD)).data?.requests?.length);

// 4. The Friends page shows friends in the page itself (no blank second): what was last asked.
const page = await fetch(A + '/?cat=friends').then((r) => r.text());
check('Friends page has the friends in it straight away', page.includes(dadA.name));

// The feed: each Catalog sends what it watched a minute after joining. Dad on A watched Fight Club.
await wait(75_000);
const feed = (await ask(A, '/api/online/c/activity')).data?.friends ?? [];
const dadItems = feed.find((f) => f.id === dadA.id)?.items ?? [];
check("the feed has Dad's Fight Club", dadItems.some((i) => i.title === 'Fight Club'), JSON.stringify(feed.map((f) => [f.name, f.items.length])));

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
