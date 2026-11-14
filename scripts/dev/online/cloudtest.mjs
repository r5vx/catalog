// Tries every address of the meeting point with two pretend houses ("Test A", "Test B").
// node cloudtest.mjs <server address> <path to secrets.local.json>
import { readFileSync } from 'node:fs';
const [base, secretsFile] = process.argv.slice(2);
const secrets = JSON.parse(readFileSync(secretsFile, 'utf8'));
let failed = 0;
const check = (name, ok, extra = '') => {
	if (!ok) failed++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};
async function ask(path, { method = 'GET', body, house, profile = 0, admin } = {}) {
	const headers = { 'Content-Type': 'application/json' };
	if (house) headers.Authorization = `Bearer ${house.house}.${house.key}`;
	if (house) headers['X-Catalog-Profile'] = String(profile);
	if (admin) headers['X-Catalog-Admin'] = admin;
	const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
	let data = null;
	try { data = await r.json(); } catch {}
	return { status: r.status, data };
}

let r = await ask('/v1/info');
check('info', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
r = await ask('/v1/houses', { method: 'POST', body: { join: 'wrong', name: 'Nope' } });
check('wrong join code refused', r.status === 403);
r = await ask('/v1/friends', { house: { house: 'AAAAAAAAAAAA', key: 'nope' } });
check('unknown house refused', r.status === 401);

const A = (await ask('/v1/houses', { method: 'POST', body: { join: secrets.JOIN_CODE, name: 'Test A' } })).data;
const B = (await ask('/v1/houses', { method: 'POST', body: { join: secrets.JOIN_CODE, name: 'Test B' } })).data;
check('two houses made', Boolean(A?.key && B?.key));
r = await ask('/v1/friends', { house: { house: A.house, key: B.key } });
check("another house's key refused", r.status === 401);

const helloA = (await ask('/v1/hello', { method: 'POST', house: A, body: { name: 'Ann' } })).data;
const helloB = (await ask('/v1/hello', { method: 'POST', house: B, body: { name: 'Bob' } })).data;
check('hello', helloA.account.name === 'Ann' && helloB.account.name === 'Bob' && helloA.account.id !== helloB.account.id);

// friends
const fcode = (await ask('/v1/friends/code', { method: 'POST', house: A })).data.code;
r = await ask('/v1/friends/add', { method: 'POST', house: A, body: { code: fcode } });
check('own friend code refused', r.status === 400 || r.status === 404, String(r.status));
const fcode2 = (await ask('/v1/friends/code', { method: 'POST', house: A })).data.code;
r = await ask('/v1/friends/add', { method: 'POST', house: B, body: { code: fcode2.toLowerCase() } });
check('friend added', r.status === 200 && r.data.name === 'Ann');
r = await ask('/v1/friends/add', { method: 'POST', house: B, body: { code: fcode2 } });
check('a code works once', r.status === 404);
await ask('/v1/presence', { method: 'PUT', house: A, body: { title: 'Test Show', type: 'tv', season: 2, episode: 3, year: 2020, poster: 'https://evil.example/x.png' } });
r = await ask('/v1/friends', { house: B });
check("friend's watching shown", r.data.friends.length === 1 && r.data.friends[0].watching?.title === 'Test Show' && r.data.friends[0].watching.poster === '', JSON.stringify(r.data.friends[0]?.watching));
await ask('/v1/seen', { method: 'PUT', house: A, body: { reset: true, add: [{ key: 'tmdb:603', title: 'The Matrix', rating: 9 }, { key: 'bad key', title: 'x' }] } });
r = await ask('/v1/seen?key=tmdb:603', { house: B });
check("friends who've seen it", r.data.friends.length === 1 && r.data.friends[0].name === 'Ann' && r.data.friends[0].rating === 9);
r = await ask('/v1/seen?key=tmdb:603', { house: A });
check('not your own', r.data.friends.length === 0);

// watch together
const room = (await ask('/v1/rooms', { method: 'POST', house: A, body: { title: 'Test Show', type: 'tv', season: 2, episode: 3, playing: true, position: 100 } })).data;
check('room made', /^[A-Z0-9]{6}$/.test(room.code) && room.host === true && room.state.position === 100);
r = await ask(`/v1/rooms/${room.code}`, { house: B });
check('room closed to non-members', r.status === 403);
r = await ask(`/v1/rooms/${room.code}/join`, { method: 'POST', house: B });
check('room joined', r.status === 200 && r.data.host === false && r.data.people.length === 2);
r = await ask(`/v1/rooms/${room.code}/state`, { method: 'PUT', house: B, body: { title: 'Test Show', type: 'tv', season: 2, episode: 3, playing: false, position: 250.5 } });
const rev = r.data.rev;
r = await ask(`/v1/rooms/${room.code}?rev=${room.rev}`, { house: A });
check('pause reaches the other house', r.data.state?.playing === false && r.data.state.position === 250.5 && r.data.state.by === 'Bob');
r = await ask(`/v1/rooms/${room.code}?rev=${rev}`, { house: A });
check('nothing new says so', r.data.same === true);

// one account on two computers, and sync
const lcode = (await ask('/v1/link/code', { method: 'POST', house: A })).data.code;
r = await ask('/v1/link/join', { method: 'POST', house: B, profile: 3, body: { code: lcode } });
check('second computer joined the account', r.status === 200 && r.data.account.id === helloA.account.id);
const t = Date.now();
r = await ask('/v1/sync', { method: 'PUT', house: A, body: { rows: [{ kind: 'progress', key: 'Show|tv|1|1', value: { at: 100 }, updated: t - 5000 }, { kind: 'entry', key: 'tmdb:1', value: { title: 'One' }, updated: t - 5000 }] } });
check('sync push', r.status === 200 && r.data.rev >= 1);
r = await ask('/v1/sync?since=0', { house: B, profile: 3 });
check('sync pull on the other computer', r.data.rows.length === 2, JSON.stringify(r.data.rows.map((x) => x.key)));
const since = r.data.rev;
await ask('/v1/sync', { method: 'PUT', house: B, profile: 3, body: { rows: [{ kind: 'progress', key: 'Show|tv|1|1', value: { at: 50 }, updated: t - 9000 }] } });
r = await ask('/v1/sync?since=0', { house: A });
check('an older change loses', r.data.rows.find((x) => x.key === 'Show|tv|1|1').value.at === 100);
await ask('/v1/sync', { method: 'PUT', house: B, profile: 3, body: { rows: [{ kind: 'progress', key: 'Show|tv|1|1', value: { at: 900 }, updated: t }] } });
r = await ask(`/v1/sync?since=${since}`, { house: A });
check('a newer change wins and is the only news', r.data.rows.length === 1 && r.data.rows[0].value.at === 900);
r = await ask('/v1/sync?since=0', { house: B, profile: 0 });
check("another account can't see it", r.data.rows.length === 0);

// reports
r = await ask('/v1/reports', { method: 'POST', house: A, body: { kind: 'stop', title: 'Test Show S2E3', body: { waited: 12 } } });
check('report sent', r.status === 200);
r = await ask('/v1/reports', { house: A });
check('reports closed without the owner key', r.status === 403);
r = await ask('/v1/reports', { admin: secrets.ADMIN_KEY });
const mine = r.data.reports?.find((x) => x.title === 'Test Show S2E3');
check('owner reads reports', Boolean(mine) && mine.houseName === 'Test A');
if (mine) await ask(`/v1/reports/${mine.id}`, { method: 'DELETE', admin: secrets.ADMIN_KEY });

// shared work
await ask('/v1/shared/skips', { method: 'PUT', house: A, body: { key: 'tmdb:1|1|1|2580', value: { intro: [10, 70] } } });
r = await ask('/v1/shared/skips?key=' + encodeURIComponent('tmdb:1|1|1|2580'), { house: B });
check('shared skip times', r.data.value?.intro?.[1] === 70);
r = await ask('/v1/shared/nope?key=x', { house: B });
check('unknown shared kind refused', r.status === 404);

// TV pairing
r = await ask('/v1/pair', { method: 'PUT', house: A, body: { name: 'Test A', addresses: ['http://192.168.1.20:4173', 'javascript:alert(1)'] } });
const pcode = r.data.code;
check('pairing code made', /^\d{6}$/.test(pcode));
r = await ask(`/v1/pair/${pcode}`);
check('TV finds the computer', r.data.addresses?.length === 1 && r.data.addresses[0] === 'http://192.168.1.20:4173');
r = await ask('/v1/pair/000000');
check('wrong pairing code', r.status === 404);

r = await ask('/v1/google/start', { method: 'POST', house: A });
check('Google sign-in off until set up', r.status === 404);
r = await ask('/v1/signout', { method: 'POST', house: B, profile: 3 });
check('sign out gives a fresh account', r.data.account.id !== helloA.account.id);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
