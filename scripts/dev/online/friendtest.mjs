// Nicknames, keeping a profile or friends private, a profile with nothing but watched titles
// (an older Catalog's), and removing a friend (2026-11-15), through two test Catalogs on 5297
// (Ann) and 5301 (Ben) and the meeting point run locally (cloud/README.md). Two EMPTY test
// libraries (never the real one); Ben's needs a TMDB key (for posters).
//   node scripts/dev/online/friendtest.mjs <Ann's library.db> <Ben's library.db> <server address> <the local D1 folder>
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';

const A = 'http://127.0.0.1:5297', B = 'http://127.0.0.1:5301';
const [, , fileA, fileB, server, d1] = process.argv;
for (const f of [fileA, fileB]) if (!f || /AppData[\\/]Roaming[\\/]Catalog/i.test(f)) throw new Error('Two test libraries, please');

let failed = 0;
const check = (name, ok, extra = '') => {
	if (!ok) failed++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};
async function ask(base, path, method = 'GET', body) {
	const r = await fetch(base + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
	return { status: r.status, data: await r.json().catch(() => null), text: '' };
}
const c = (base, path, method, body) => ask(base, `/api/online/c/${path}`, method, body);

for (const [base, name] of [[A, 'Ann'], [B, 'Ben']]) check(`${name} joins`, (await ask(base, '/api/online', 'POST', { action: 'connect', join: 'TESTJOIN', name })).status === 200);
const code = (await c(A, 'friends/code', 'POST', {})).data?.code;
check('Ben adds Ann', (await c(B, 'friends/add', 'POST', { code })).status === 200);
const ann = (await c(B, 'friends')).data?.friends?.find((f) => f.name === 'Ann');
const ben = (await c(A, 'friends')).data?.friends?.find((f) => f.name === 'Ben');
check('both ids known', Boolean(ann?.id && ben?.id));

// An older Catalog's watched titles: no year, type or poster (seen rows only).
execFileSync(
	process.platform === 'win32' ? 'npx.cmd' : 'npx',
	['--yes', 'wrangler@4', 'd1', 'execute', 'catalog-meeting', '--local', '--persist-to', `"${d1}"`, '--command',
		`"INSERT INTO seen (account, tkey, title, rating) VALUES ('${ann.id}', 'tmdb:movie:603', 'The Matrix', NULL), ('${ann.id}', 'tmdb:tv:1396', 'Breaking Bad', NULL)"`],
	{ cwd: new URL('../../../cloud/', import.meta.url), stdio: 'ignore', shell: true }
);
let page = await (await fetch(`${B}/friends/${ann.id}`)).text();
check("Ann's profile shows what she watched though nothing else", page.includes('The Matrix') && page.includes('Breaking Bad') && !page.includes('Nothing to show yet'), '');
check('with posters looked up here', /image\.tmdb\.org\/t\/p\/w342\/[^"]+/.test(page), '');

// A nickname.
check('Ben names her "Annie"', (await ask(B, '/api/online/nickname', 'POST', { id: ann.id, nickname: 'Annie' })).status === 200);
const card = (await c(B, 'friends')).data?.friends?.find((f) => f.id === ann.id);
check("Ben's Friends list says Annie, and keeps her own name", card?.name === 'Annie' && card?.realName === 'Ann', JSON.stringify({ name: card?.name, real: card?.realName }));
page = await (await fetch(`${B}/friends/${ann.id}`)).text();
check('her profile is headed Annie, with Ann under it', page.includes('Annie') && /real-name[^"]*">Ann</.test(page), '');
const annSees = (await c(A, 'friends')).data?.me;
check('Ann still sees her own name', annSees?.name === 'Ann');
await ask(B, '/api/online/nickname', 'POST', { id: ann.id, nickname: '' });
check('taken away, back to Ann', (await c(B, 'friends')).data?.friends?.find((f) => f.id === ann.id)?.name === 'Ann');

// Keeping her profile private.
const mine = (await c(A, `people/${ann.id}/profile`)).data;
check('her own profile says what she keeps private (nothing yet)', mine?.privacy?.hideProfile === false && mine?.privacy?.hideFriends === false, JSON.stringify(mine?.privacy));
check('Ann keeps her profile private', (await c(A, 'privacy', 'PUT', { hideProfile: true, hideFriends: false })).status === 200);
const hidden = (await c(B, `people/${ann.id}/profile`)).data;
check('Ben sees her name and nothing she watched', hidden?.hidden === true && hidden?.name === 'Ann' && hidden.counts.total === 0 && !hidden.top.length, JSON.stringify(hidden?.counts));
check('and not her library', (await c(B, `people/${ann.id}/library`)).status === 403);
check('nor that she watched The Matrix', !(await c(B, 'seen?key=tmdb:movie:603&title=The%20Matrix')).data?.friends?.length);
page = await (await fetch(`${B}/friends/${ann.id}`)).text();
check('the page says she keeps it private', page.includes('keeps their profile private') && !page.includes('View their library'), '');
const ownView = (await c(A, `people/${ann.id}/profile`)).data;
check('Ann still sees her own profile', ownView?.hidden !== true && ownView?.counts?.total === 2, JSON.stringify(ownView?.counts));

// Keeping her friends private.
check('Ann keeps her friends private', (await c(A, 'privacy', 'PUT', { hideProfile: false, hideFriends: true })).status === 200);
const theirs = (await c(B, `friends/${ann.id}/friends`)).data;
check("Ben gets no list of Ann's friends", theirs?.hidden === true && theirs.friends.length === 0, JSON.stringify(theirs));
check('her profile shows again', (await c(B, `people/${ann.id}/profile`)).data?.hidden !== true);
await c(A, 'privacy', 'PUT', { hideProfile: false, hideFriends: false });

// Removing a friend.
check('Ben removes Ann', (await c(B, `friends/${ann.id}`, 'DELETE')).status === 200);
check('she is gone from his list', !(await c(B, 'friends')).data?.friends?.some((f) => f.id === ann.id));
check('and he from hers', !(await c(A, 'friends')).data?.friends?.some((f) => f.id === ben.id));
check('her profile is closed to him', (await c(B, `people/${ann.id}/profile`)).status === 403);

for (const f of [fileA, fileB]) new DatabaseSync(f).close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
