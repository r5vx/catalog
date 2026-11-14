// Two test Catalogs (library copies on 5297 and 5298) as two houses, through the real meeting point.
// node housetest.mjs <path to secrets.local.json>
import { readFileSync } from 'node:fs';
const secrets = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const A = 'http://127.0.0.1:5297';
const B = 'http://127.0.0.1:5301';
let failed = 0;
const check = (name, ok, extra = '') => {
	if (!ok) failed++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};
async function ask(base, path, method = 'GET', body) {
	const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
	let data = null;
	try { data = await r.json(); } catch {}
	return { status: r.status, data };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await ask(A, '/api/online', 'POST', { action: 'disconnect' });
await ask(B, '/api/online', 'POST', { action: 'disconnect' });
let r = await ask(A, '/api/online');
check('A starts offline', r.data.connected === false);
r = await ask(A, '/api/online/c/friends');
check('pages told "not online"', r.status === 502 && /isn't online/.test(r.data?.error ?? ''), JSON.stringify(r.data));
r = await ask(A, '/api/online', 'POST', { action: 'connect', join: 'WRONG-CODE' });
check('wrong join code refused', r.status === 403, String(r.status));
r = await ask(A, '/api/online', 'POST', { action: 'connect', join: secrets.JOIN_CODE.toLowerCase() });
check('A connects', r.status === 200, JSON.stringify(r.data));
r = await ask(B, '/api/online', 'POST', { action: 'connect', join: secrets.JOIN_CODE });
check('B connects', r.status === 200);
const a = (await ask(A, '/api/online')).data;
const b = (await ask(B, '/api/online')).data;
check('each is someone', a.connected && b.connected && a.account?.id && b.account?.id && a.account.id !== b.account.id, `${a.account?.name} / ${b.account?.name}`);
await ask(A, '/api/online/c/me', 'PUT', { name: 'Ann' });
await ask(B, '/api/online/c/me', 'PUT', { name: 'Bob' });

// friends, and what a friend is watching
const code = (await ask(A, '/api/online/c/friends/code', 'POST', {})).data.code;
r = await ask(B, '/api/online/c/friends/add', 'POST', { code });
check('friends by code', r.status === 200 && r.data.name === 'Ann');
await ask(A, '/api/watch/progress', 'POST', { title: 'Online Test Show', type: 'tv', season: 1, episode: 2, currentTime: 300, duration: 1500, posterUrl: '' });
await wait(1500);
r = await ask(B, '/api/online/c/friends');
check("B sees what A is watching", r.data.friends?.[0]?.watching?.title === 'Online Test Show' && r.data.friends[0].watching.episode === 2, JSON.stringify(r.data.friends?.[0]));

// watching together (the room itself; the player's part is tried in the browser)
const room = (await ask(A, '/api/online/c/rooms', 'POST', { title: 'Online Test Show', type: 'tv', season: 1, episode: 2, playing: true, position: 300 })).data;
r = await ask(B, `/api/online/c/rooms/${room.code}/join`, 'POST', {});
check('room joined from the other house', r.status === 200 && r.data.people.length === 2 && r.data.state.title === 'Online Test Show');
r = await ask(B, '/api/online/c/reports');
check('addresses not on the list are refused', r.status === 404);

// one person on both computers, progress in step
const link = (await ask(A, '/api/online/c/link/code', 'POST', {})).data.code;
r = await ask(B, '/api/online/c/link/join', 'POST', { code: link });
check('B joined A\'s account', r.status === 200 && r.data.account.id === a.account.id);
await ask(A, '/api/online', 'POST', { action: 'sync', on: true });
await ask(B, '/api/online', 'POST', { action: 'sync', on: true });
await wait(6000);
r = await ask(A, '/api/online', 'POST', { action: 'syncNow' });
check('A sync round', r.data.error === '', JSON.stringify(r.data));
r = await ask(B, '/api/online', 'POST', { action: 'syncNow' });
check('B sync round', r.data.error === '', JSON.stringify(r.data));
r = await ask(B, '/api/watch/progress?title=Online%20Test%20Show&type=tv&season=1&episode=2');
check("A's place arrived on B", Math.round(r.data?.currentTime ?? r.data?.current_time ?? -1) === 300, JSON.stringify(r.data).slice(0, 200));
await wait(1100);
await ask(B, '/api/watch/progress', 'POST', { title: 'Online Test Show', type: 'tv', season: 1, episode: 2, currentTime: 900, duration: 1500, posterUrl: '' });
await ask(B, '/api/online', 'POST', { action: 'syncNow' });
await ask(A, '/api/online', 'POST', { action: 'syncNow' });
r = await ask(A, '/api/watch/progress?title=Online%20Test%20Show&type=tv&season=1&episode=2');
check("B's later place arrived on A", Math.round(r.data?.currentTime ?? r.data?.current_time ?? -1) === 900, JSON.stringify(r.data).slice(0, 200));

// shared skip times
await ask(A, '/api/watch/skip-found', 'POST', { found: [{ key: 'vidrift:tv:999999:1:1:avc', segments: [{ type: 'intro', start: 12, end: 71.5 }] }] });
await wait(1500);
r = await ask(B, '/api/watch/skip-found?key=vidrift:tv:999999:1:1:avc');
check("A's intro time used by B", r.data.segments?.[0]?.end === 71.5, JSON.stringify(r.data));

// problem reports
await ask(B, '/api/watch/playback-log', 'POST', { title: 'Online Test Show S1E2', lasted: 14, waitingFor: 'https://example.com/piece.ts?token=SECRET123', source: '7Movies' });
await wait(1500);
r = await ask(A, '/api/online/reports');
check('reports closed without the owner key', r.status !== 200);
await ask(A, '/api/online', 'POST', { action: 'owner', key: secrets.ADMIN_KEY });
r = await ask(A, '/api/online/reports');
const report = r.data.reports?.find((x) => x.title === 'Online Test Show S1E2');
check('the owner sees B\'s report', Boolean(report), JSON.stringify(r.data).slice(0, 160));
if (report) {
	const full = (await ask(A, `/api/online/reports?id=${report.id}`)).data;
	check('addresses in a report lose their secrets', !full.body.includes('SECRET123') && full.body.includes('piece.ts?'), full.body.slice(0, 220));
}

// TV pairing
r = await ask(A, '/api/online/pair');
check('pairing code', /^\d{6}$/.test(r.data?.code ?? ''), JSON.stringify(r.data));
if (r.data?.code) {
	const found = await (await fetch(`https://catalog-meeting.catalog-meet-f5725.workers.dev/v1/pair/${r.data.code}`)).json();
	check('the TV would get this computer\'s address', Array.isArray(found.addresses) && found.addresses.length > 0 && found.addresses.every((x) => /:5297$/.test(x)), JSON.stringify(found));
}

// switches
await ask(B, '/api/online', 'POST', { action: 'switches', reports: false, share: true, shared: true });
r = await ask(B, '/api/online');
check('a switch stays off', r.data.switches.reports === false && r.data.switches.share === true);

// the downloads changes
r = await ask(A, '/api/downloads/ahead');
check('downloaded-ahead list answers', Array.isArray(r.data?.ahead), JSON.stringify(r.data).slice(0, 120));
r = await ask(A, '/api/downloads/showbox-room');
check('Showbox room answers', typeof r.data?.bytes === 'number', JSON.stringify(r.data));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
