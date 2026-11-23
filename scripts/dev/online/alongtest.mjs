// Watching along, the year friends are told, and "offline for now", through two test Catalogs
// (5297 and 5301) that are already friends (run seentest.mjs first, same local meeting point).
//   node scripts/dev/online/alongtest.mjs
const A = 'http://127.0.0.1:5297', B = 'http://127.0.0.1:5301';
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
async function ask(base, path, method = 'GET', body) {
	const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
	return { status: r.status, data: await r.json().catch(() => null) };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bob = async () => (await ask(A, '/api/online/c/friends')).data?.friends?.find((f) => f.name === 'Bob');
const progress = (title) => ask(B, '/api/watch/progress', 'POST', { title, type: 'movie', season: 0, episode: 0, currentTime: 60, duration: 6000, posterUrl: '' });

let r = await ask(B, '/api/online?light=1');
check('the light answer: connected, watching along on to begin with', r.data.connected === true && r.data.switches.along === true, JSON.stringify(r.data));
await ask(B, '/api/online', 'POST', { action: 'switches', reports: true, share: true, shared: true, along: false });

// Along off: friends get the year, never the room.
const room = (await ask(B, '/api/online/c/rooms', 'POST', { title: 'Along Film', type: 'movie', year: '1999', playing: true, position: 60 })).data.code;
await ask(B, '/api/online', 'POST', { action: 'watching', title: 'Along Film', year: '1999', room });
await progress('Along Film');
await wait(1500);
let seen = (await bob())?.watching;
check('watching now carries the year', seen?.title === 'Along Film' && seen.year === '1999', JSON.stringify(seen));
check('and no room while watching along is off', seen?.room === '', JSON.stringify(seen));

// Along on: the room goes with it, and a friend can join it.
await ask(B, '/api/online', 'POST', { action: 'switches', reports: true, share: true, shared: true, along: true });
await ask(B, '/api/online', 'POST', { action: 'watching', title: 'Along Film 2', year: '2004', room });
await progress('Along Film 2');
await wait(1500);
seen = (await bob())?.watching;
check('with it on, friends get the room', seen?.title === 'Along Film 2' && seen.year === '2004' && seen.room === room, JSON.stringify(seen));
r = await ask(A, `/api/online/c/rooms/${seen?.room}/join`, 'POST', {});
check('Ann joins it from the friend list', r.status === 200 && r.data.people.length === 2 && r.data.host === false, JSON.stringify(r.data?.people));
// A saved place for something else than the player said: no year or room borrowed from it.
await ask(B, '/api/online', 'POST', { action: 'watching', title: 'Along Film 3', year: '2010', room });
await progress('Unrelated Film');
await wait(1500);
seen = (await bob())?.watching;
check("another title's year and room are not borrowed", seen?.title === 'Unrelated Film' && seen.year === '' && seen.room === '', JSON.stringify(seen));
await ask(B, '/api/online', 'POST', { action: 'switches', reports: true, share: true, shared: true, along: false });

// Offline for now, and back: the same person, the same friends.
const before = (await ask(A, '/api/online')).data;
await ask(A, '/api/online', 'POST', { action: 'disconnect' });
r = await ask(A, '/api/online');
check('offline: not connected, but remembered', r.data.connected === false && r.data.joined === true, JSON.stringify(r.data));
r = await ask(A, '/api/online/c/friends');
check('offline: nothing is asked of the server', r.status === 502 && /isn't online/.test(r.data?.error ?? ''), JSON.stringify(r.data));
r = await ask(B, '/api/online/c/friends');
check('Bob still has Ann as a friend meanwhile', r.data.friends.some((f) => f.name === 'Ann'));
r = await ask(A, '/api/online', 'POST', { action: 'connect', join: '' });
check('back online without the join code', r.status === 200);
const after = (await ask(A, '/api/online')).data;
check('the same person as before', after.connected && after.account?.id === before.account?.id && after.account.name === 'Ann', `${before.account?.id} / ${after.account?.id}`);
r = await ask(A, '/api/online/c/friends');
check('with the same friends', r.data.friends?.some((f) => f.name === 'Bob'), JSON.stringify(r.data.friends?.map((f) => f.name)));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
