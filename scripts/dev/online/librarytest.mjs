// One person's library kept in step between two computers (src/lib/server/librarySync.ts), through
// two test Catalogs on 5297 (A) and 5301 (B) and the meeting point run locally (cloud/README.md).
// Both libraries must be empty test ones seeded with librarytest-seed.mjs; never the real library.
//   node scripts/dev/online/librarytest.mjs <A's library.db> <B's library.db>
import { DatabaseSync } from 'node:sqlite';

const A = 'http://127.0.0.1:5297', B = 'http://127.0.0.1:5301';
const [, , fileA, fileB] = process.argv;
for (const f of [fileA, fileB]) if (!f || /AppData[\\/]Roaming[\\/]Catalog/i.test(f)) throw new Error('Two test libraries, please');
let failed = 0;
const check = (name, ok, extra = '') => {
	if (!ok) failed++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};
const TV = { 'User-Agent': 'CatalogTV/1.0 (test)', Cookie: 'catalog_profile=1' };
async function ask(base, path, method = 'GET', body, headers = {}) {
	const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
	return { status: r.status, data: await r.json().catch(() => null) };
}
const online = (base, body, headers) => ask(base, '/api/online', 'POST', body, headers).then((r) => r.data);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const look = (file) => new DatabaseSync(file, { readOnly: true });
const entry = (file, title) => look(file).prepare('SELECT * FROM entries WHERE title = ?').get(title);
const count = (file, sql, ...args) => look(file).prepare(sql).get(...args).n;

// Online, and one person on both computers (and Dad on both, by his own code).
for (const base of [A, B]) check(`${base} joins`, (await ask(base, '/api/online', 'POST', { action: 'connect', join: 'TESTJOIN' })).status === 200);
let code = (await ask(A, '/api/online/c/link/code', 'POST', {})).data?.code;
check('B joins A with a link code', (await ask(B, '/api/online/c/link/join', 'POST', { code })).status === 200);
code = (await ask(A, '/api/online/c/link/code', 'POST', {}, TV)).data?.code;
check("Dad's B joins Dad's A", (await ask(B, '/api/online/c/link/join', 'POST', { code }, TV)).status === 200);
const idA = (await ask(A, '/api/online')).data?.account?.id, idB = (await ask(B, '/api/online')).data?.account?.id;
check('the same person on both', idA && idA === idB, `${idA} / ${idB}`);

// Before anything: what A would do.
let p = (await online(A, { action: 'libraryPreview' })).preview;
check('A preview: 4 here, none there, 4 to send, 1 by name', p?.here === 4 && p.there === 0 && p.send === 4 && p.nameOnly === 1, JSON.stringify(p));
check('the preview changed nothing', count(fileA, 'SELECT count(*) AS n FROM entries') === 5);

let r = (await online(A, { action: 'library', on: true })).round;
check('A sends its 4, the long review left out', r.sent === 4 && r.longNotes === 1 && !r.error, JSON.stringify(r));
check('A backed up its library first', count(fileA, "SELECT count(*) AS n FROM entries") > 0 && (await import('node:fs')).readdirSync(fileA.replace(/library\.db$/, 'backups')).some((f) => f.startsWith('library-before-library-sync-0-')));

p = (await online(B, { action: 'libraryPreview' })).preview;
check('B preview: 4 here, 4 there, 1 to add (Breaking Bad), some to update', p?.here === 4 && p.there === 4 && p.add === 1 && p.update >= 1, JSON.stringify(p));
r = (await online(B, { action: 'library', on: true })).round;
check('B: sent its own, took and added A\'s', !r.error && r.added === 1 && r.taken >= 1, JSON.stringify(r));
check('add on A → on B (Breaking Bad, with its rating and status)', entry(fileB, 'Breaking Bad')?.rating === 8.5 && entry(fileB, 'Breaking Bad')?.status === 'caught_up');
check('newer on A wins on B (Fight Club 9, its review)', entry(fileB, 'Fight Club')?.rating === 9 && entry(fileB, 'Fight Club')?.notes === 'Seen it twice');
check('same show from the other site not doubled on B', count(fileB, "SELECT count(*) AS n FROM entries WHERE title = 'Cowboy Bebop'") === 1);
check("a review too long to send leaves B's alone", entry(fileB, 'Long Review Film')?.notes === 'short on B' && entry(fileB, 'Long Review Film')?.rating === 7, JSON.stringify({ notes: entry(fileB, 'Long Review Film')?.notes, rating: entry(fileB, 'Long Review Film')?.rating }));
check('titles typed in by name stay on A', !entry(fileB, 'Home Video'));
r = await online(B, { action: 'libraryNow' });
check('B sends nothing back as news next round', r.sent === 0 && !r.error, JSON.stringify(r));

r = await online(A, { action: 'libraryNow' });
check('A takes Dune from B', !r.error && entry(fileA, 'Dune')?.status === 'planned', JSON.stringify(r));
check('same show from the other site not doubled on A', count(fileA, "SELECT count(*) AS n FROM entries WHERE title = 'Cowboy Bebop'") === 1);

// A rating changed on B reaches A.
await ask(B, '/api/entries', 'PATCH', { id: entry(fileB, 'Fight Club').id, action: 'set', fields: { rating: 6 } });
await online(B, { action: 'libraryNow' });
await online(A, { action: 'libraryNow' });
check('rating changed on B → A', entry(fileA, 'Fight Club')?.rating === 6, String(entry(fileA, 'Fight Club')?.rating));

// Both changed: the later one wins, on both.
await ask(A, '/api/entries', 'PATCH', { id: entry(fileA, 'Fight Club').id, action: 'set', fields: { status: 'rewatching' } });
await wait(50);
await ask(B, '/api/entries', 'PATCH', { id: entry(fileB, 'Fight Club').id, action: 'set', fields: { rating: 4 } });
await online(A, { action: 'libraryNow' });
await online(B, { action: 'libraryNow' });
await online(A, { action: 'libraryNow' });
const fa = entry(fileA, 'Fight Club'), fb = entry(fileB, 'Fight Club');
check('both changed: the later (B) wins on both', fa.rating === 4 && fb.rating === 4 && fa.status === fb.status && fa.status === 'completed', JSON.stringify({ a: [fa.rating, fa.status], b: [fb.rating, fb.status] }));

// Removed on A: still on B, and doesn't come back to A.
await ask(A, '/api/entries', 'DELETE', { id: entry(fileA, 'Dune').id });
await online(A, { action: 'libraryNow' });
await online(B, { action: 'libraryNow' });
await online(A, { action: 'libraryNow' });
check('removed on A → still on B', Boolean(entry(fileB, 'Dune')));
check('and stays removed on A', !entry(fileA, 'Dune'));

// Dad's own list on both.
for (const base of [A, B]) {
	await online(base, { action: 'library', on: true }, TV);
	await online(base, { action: 'libraryNow' }, TV);
}
r = await online(A, { action: 'libraryNow' }, TV);
const dadA = look(fileA).prepare("SELECT title, status FROM profile_titles WHERE profile = 1 ORDER BY title").all().map((t) => `${t.title}:${t.status}`).join(',');
const dadB = look(fileB).prepare("SELECT title, status FROM profile_titles WHERE profile = 1 ORDER BY title").all().map((t) => `${t.title}:${t.status}`).join(',');
check("Dad's lists in step (not the library's)", dadA === 'Dune:planned,Fight Club:completed' && dadB === dadA, `${dadA} / ${dadB}`);
check("Dad's titles didn't go into the owner's library", !entry(fileA, 'Dune'));

// 1,000 titles in one go.
{
	const db = new DatabaseSync(fileA, { timeout: 10_000 });
	const cat = db.prepare("SELECT id FROM categories WHERE slug = 'movies'").get().id;
	const add = db.prepare("INSERT INTO entries (category_id, title, year, status, source, source_id, created_at, updated_at) VALUES (?, ?, 2000, 'completed', 'tmdb', ?, ?, ?)");
	db.exec('BEGIN');
	for (let i = 0; i < 1000; i++) {
		const now = new Date().toISOString();
		add.run(cat, `Bulk Film ${i}`, `movie:${9_000_000 + i}`, now, now);
	}
	db.exec('COMMIT');
	db.close();
}
r = await online(A, { action: 'libraryNow' });
check('A sends 1,000 new titles', r.sent === 1000 && !r.error, JSON.stringify(r));
r = await online(B, { action: 'libraryNow' });
check('B adds at most 300 a round, the rest next', r.added === 300 && r.left === 700, JSON.stringify(r));
for (let i = 0; i < 40 && count(fileB, "SELECT count(*) AS n FROM entries WHERE title LIKE 'Bulk Film %'") < 1000; i++) await wait(1000);
check('all 1,000 on B by themselves, one round after another', count(fileB, "SELECT count(*) AS n FROM entries WHERE title LIKE 'Bulk Film %'") === 1000);

for (const [name, file] of [['A', fileA], ['B', fileB]]) check(`${name}'s library is sound`, look(file).prepare('PRAGMA integrity_check').get().integrity_check === 'ok');
const diag = (await ask(B, '/api/diagnostics')).data?.librarySync;
check('diagnostics say how the last round went', Array.isArray(diag?.profiles) && diag.profiles.includes(0) && diag.last?.['0']?.at > 0, JSON.stringify(diag?.profiles));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
