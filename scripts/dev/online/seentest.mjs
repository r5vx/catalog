const A = 'http://127.0.0.1:5297', B = 'http://127.0.0.1:5301';
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const DAD = { cookie: 'catalog_profile=1', 'x-forwarded-for': '192.168.1.50' };
async function ask(base, path, method = 'GET', body, extra = {}) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = r.headers.get('content-type') ?? '';
  let data = null;
  if (/json/.test(type)) data = await r.json().catch(() => null); else data = { bytes: (await r.arrayBuffer()).byteLength, type };
  return { status: r.status, data };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let r = await ask(A, '/api/online', 'POST', { action: 'connect', join: 'testjoin', name: 'Ann' });
check('A connects (local meeting point)', r.status === 200, JSON.stringify(r.data));
r = await ask(B, '/api/online', 'POST', { action: 'connect', join: 'TESTJOIN', name: 'Bob' });
check('B connects', r.status === 200);
const started = Date.now();
const dad = (await ask(A, '/api/online', 'GET', undefined, DAD)).data;
check("A's second profile is its own person, named after the profile", dad.account?.name === 'Dad', JSON.stringify(dad.account));
r = await ask(A, '/api/online/c/me', 'PUT', { name: 'Ann' });
check('name saved, answer carries the account', r.data?.account?.name === 'Ann' && r.data.account.avatar === 0, JSON.stringify(r.data));
await ask(B, '/api/online/c/me', 'PUT', { name: 'Bob' });
const a = (await ask(A, '/api/online')).data;
check('A and Dad are different people', a.account.id !== dad.account.id);
let code = (await ask(A, '/api/online/c/friends/code', 'POST', {})).data.code;
await ask(B, '/api/online/c/friends/add', 'POST', { code });
code = (await ask(A, '/api/online/c/friends/code', 'POST', {}, DAD)).data.code;
r = await ask(B, '/api/online/c/friends/add', 'POST', { code });
check('Bob is friends with Ann and Dad', r.status === 200 && r.data.name === 'Dad', JSON.stringify(r.data));

// pictures
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
r = await ask(A, '/api/online/c/me', 'PUT', { avatar: 'data:text/html;base64,PHNjcmlwdD4=' });
check('a picture that is not a picture is refused', r.status === 400, JSON.stringify(r.data));
r = await ask(A, '/api/online/c/me', 'PUT', { avatar: png });
check('picture saved', r.status === 200 && r.data.account.avatar > 0 && r.data.account.name === 'Ann', JSON.stringify(r.data));
r = await ask(B, '/api/online/c/friends');
const ann = r.data.friends.find((f) => f.name === 'Ann');
check("Bob's friend list carries Ann's picture number", ann?.avatar > 0 && r.data.friends.find((f) => f.name === 'Dad')?.avatar === 0, JSON.stringify(r.data.friends));
r = await ask(B, `/api/online/avatar/${ann.id}?v=${ann.avatar}`);
check('Bob gets the picture itself', r.status === 200 && r.data.type === 'image/png' && r.data.bytes > 50, JSON.stringify(r.data));
r = await ask(B, `/api/online/avatar/${dad.account.id}`);
check('no picture answers 404', r.status === 404);
r = await ask(B, '/api/online/avatar/..%2Fv1%2Freports');
check('an odd id is refused', r.status === 404);

// watched titles: sent 90 s after connecting
console.log('waiting for the watched titles to be sent…');
await wait(Math.max(0, 100_000 - (Date.now() - started)));
const seen = async (base, key, title, extra) => (await ask(base, `/api/online/c/seen?key=${encodeURIComponent(key)}&title=${encodeURIComponent(title)}`, 'GET', undefined, extra)).data;
r = await seen(B, 'tmdb:movie:550', 'Fight Club');
check('a film: Ann (rated 9) and Dad watched it', r.friends?.length === 2 && r.friends[0].name === 'Ann' && r.friends[0].rating === 9 && r.friends[0].avatar > 0 && r.friends[1].name === 'Dad' && r.friends[1].rating === null, JSON.stringify(r));
r = await seen(B, 'tmdb:tv:1396', 'Breaking Bad');
check('a show Ann is caught up on', r.friends?.length === 1 && r.friends[0].rating === 8.5, JSON.stringify(r));
r = await seen(B, 'tmdb:movie:438631', 'Dune');
check('a film only on her watchlist is not "watched"', r.friends?.length === 0, JSON.stringify(r));
r = await seen(B, 'tmdb:tv:30991', 'cowboy bebop');
check('an anime she has from AniList, asked from its TMDB page', r.friends?.length === 1 && r.friends[0].name === 'Ann', JSON.stringify(r));
r = await seen(B, 'tmdb:movie:999', 'Fight Club');
check('another film of the same name on the same site is not matched', r.friends?.length === 0, JSON.stringify(r));
r = await seen(A, 'tmdb:movie:550', 'Fight Club');
check('Ann sees nobody (Bob has watched nothing)', r.friends?.length === 0, JSON.stringify(r));
r = await seen(A, 'tmdb:movie:550', 'Fight Club', DAD);
check('Dad sees nobody too (he and Ann are not friends online)', r.friends?.length === 0, JSON.stringify(r));
r = await ask(A, '/api/online/c/me', 'PUT', { avatar: '' });
check('picture removed', r.data?.account?.avatar === 0, JSON.stringify(r.data));
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
