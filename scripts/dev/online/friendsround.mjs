// The 2026-11-15 friends round, through two test Catalogs on 5297 (A) and 5301 (B) and the meeting
// point run locally (cloud/README.md): lasting friend codes, profiles, a friend's library, the
// episode in the feed, whispers and unread counts, a room's chat riding along with its looks, and a
// room told why a player paused. Libraries: two EMPTY test ones seeded with librarytest-seed.mjs
// (never the real library), servers started just before. Takes ~2 minutes (the feed and the
// watched list are sent 60 and 90 s after joining).
//   node scripts/dev/online/friendsround.mjs <A's library.db> <B's library.db>
import { DatabaseSync } from 'node:sqlite';

const A = 'http://127.0.0.1:5297', B = 'http://127.0.0.1:5301';
const [, , fileA, fileB] = process.argv;
for (const f of [fileA, fileB]) if (!f || /AppData[\\/]Roaming[\\/]Catalog/i.test(f)) throw new Error('Two test libraries, please');
let failed = 0;
const check = (name, ok, extra = '') => {
	if (!ok) failed++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};
const DAD = { 'User-Agent': 'CatalogTV/1.0 (test)', Cookie: 'catalog_profile=1' };
async function ask(base, path, method = 'GET', body, headers = {}) {
	const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
	return { status: r.status, data: await r.json().catch(() => null) };
}
const c = (base, path, method, body, headers) => ask(base, `/api/online/c/${path}`, method, body, headers);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const started = Date.now();

// A's Breaking Bad S1E3, nearly all watched: the feed should say the episode.
{
	const db = new DatabaseSync(fileA);
	db.prepare(`INSERT INTO watch_progress (profile, title, type, season, episode, "current_time", duration, updated_at) VALUES (0, 'Breaking Bad', 'tv', 1, 3, 2700, 2800, datetime('now'))`).run();
	db.close();
}

for (const [base, name] of [[A, 'Ann'], [B, 'Ben']]) check(`${name} joins`, (await ask(base, '/api/online', 'POST', { action: 'connect', join: 'TESTJOIN', name })).status === 200);

// Friend codes that stay the same.
const code1 = (await c(A, 'friends/code', 'POST', {})).data?.code;
const code2 = (await c(A, 'friends/code', 'POST', {})).data?.code;
check('a friend code stays the same', code1 && code1 === code2, `${code1} / ${code2}`);
const code3 = (await c(A, 'friends/code', 'POST', { fresh: true })).data?.code;
check('a new code when asked', code3 && code3 !== code1);
check('the old code stops working', (await c(B, 'friends/add', 'POST', { code: code1 })).status === 404);
const added = await c(B, 'friends/add', 'POST', { code: code3 });
check('Ben adds Ann by her code', added.status === 200 && added.data?.name === 'Ann', JSON.stringify(added.data));
check('the same code works again (it lasts)', (await c(B, 'friends/add', 'POST', { code: code3 })).data?.error === "You're friends already");
check('the code is the same after adding', (await c(A, 'friends/code', 'POST', {})).data?.code === code3);
// Dad, on A's computer, is a stranger to Ben: he can still add Ann's lasting code.
check("Dad can use Ann's code too", (await c(A, 'friends/add', 'POST', { code: code3 }, DAD)).status === 200);
const friendsB = (await c(B, 'friends')).data;
const ann = friendsB?.friends?.find((f) => f.name === 'Ann');
const ben = (await c(A, 'friends')).data?.friends?.find((f) => f.name === 'Ben');
const me = friendsB?.me;
check('Ben has Ann as a friend', Boolean(ann && ben && me?.id));

// Profiles.
check('Ann saves her profile', (await c(A, 'profile', 'PUT', { bio: 'Films at night', color: '#3366CC', favorites: [{ key: 'tmdb:movie:550', title: 'Fight Club', year: '1999', type: 'movie', poster: 'https://image.tmdb.org/t/p/w342/x.jpg' }, { key: 'bad key', title: 'x' }] })).status === 200);
const profile = (await c(B, `people/${ann.id}/profile`)).data;
check('her profile: bio, color, one good favorite', profile?.bio === 'Films at night' && profile.color === '#3366cc' && profile.favorites?.length === 1, JSON.stringify(profile?.favorites));
check('when she joined, friends since', profile?.joined > started - 60_000 && profile.friendsSince > 0 && profile.me === false);
check('Dad (a friend of Ann only) is a friend in common? no', profile?.mutual === 0, String(profile?.mutual));
const own = (await c(B, `people/${me.id}/profile`)).data;
check('your own profile opens, marked as yours', own?.me === true && own.friendsSince === null);
check("a stranger's profile is refused", (await c(B, `people/${(await c(A, 'friends', 'GET', undefined, DAD)).data?.me?.id}/profile`)).status === 403);

// Whispers.
const first = (await c(A, 'messages?after=')).data;
check('the first look only says where things stand', Array.isArray(first?.messages) && first.messages.length === 0 && typeof first.last === 'number');
check('Ben whispers to Ann', (await c(B, 'messages', 'POST', { to: ann.id, text: 'Hey, watching anything?' })).status === 200);
await c(B, 'messages', 'POST', { to: ann.id, text: 'Second one' });
const news = (await c(A, `messages?after=${first.last}`)).data;
check('Ann gets both, oldest first', news?.messages?.length === 2 && news.messages[0].text === 'Hey, watching anything?' && news.messages[0].name === 'Ben', JSON.stringify(news?.messages?.map((m) => m.text)));
check('two unread', news?.unread === 2, String(news?.unread));
const threads = (await c(A, 'messages/threads')).data;
const withBen = threads?.threads?.find((t) => t.id === ben.id);
check('threads: Ben first, 2 unread, his last line', withBen?.unread === 2 && withBen.last?.text === 'Second one' && threads.threads[0].id === ben.id);
check('read up to the last', (await c(A, 'messages/read', 'POST', { with: ben.id, upto: news.messages[1].id })).data?.unread === 0);
const history = (await c(A, `messages/with/${ben.id}`)).data;
check('the conversation has both', history?.messages?.length === 2);
check('Ann answers', (await c(A, 'messages', 'POST', { to: ben.id, text: 'Inception, join?' })).status === 200);
check('Ben is not sent his own lines as new', (await c(B, `messages?after=${first.last}`)).data?.messages?.every((m) => m.from !== me.id));
check("whispers only between friends (Dad and Ben aren't)", (await c(A, 'messages', 'POST', { to: me.id, text: 'hi' }, DAD)).status === 403);
check('an empty message is refused', (await c(B, 'messages', 'POST', { to: ann.id, text: '   ' })).status === 400);

// A room: its chat rides along with the looks, and a player's own pause says why.
const room = (await c(A, 'rooms', 'POST', { title: 'Inception', type: 'movie', year: '2010', playing: true, position: 10 })).data;
const joined = (await c(B, `rooms/${room.code}/join?msg=`, 'POST', {})).data;
check('joining a room brings its chat so far and where things stand', Array.isArray(joined?.chat?.history) && joined.chat.last > 0, JSON.stringify(joined?.chat));
check('a line in the group', (await c(A, 'messages', 'POST', { room: room.code, text: 'Starting now' })).status === 200);
check("a room's chat only for those in it", (await c(A, 'messages', 'POST', { room: room.code, text: 'x' }, DAD)).status === 403);
const look = (await c(B, `rooms/${room.code}?rev=${joined.rev}&people=&msg=${joined.chat.last}`)).data;
check('the line comes with the next look', look?.chat?.messages?.some((m) => m.text === 'Starting now' && m.room === room.code), JSON.stringify(look?.chat));
await c(A, `rooms/${room.code}/state`, 'PUT', { title: 'Inception', type: 'movie', year: '2010', playing: false, position: 42, waiting: 'is switching to the sharpest copy' });
const paused = (await c(B, `rooms/${room.code}?rev=0`)).data;
check('the room says why the player paused', paused?.state?.waiting === 'is switching to the sharpest copy' && paused.state.playing === false, JSON.stringify(paused?.state));
await c(A, `rooms/${room.code}/state`, 'PUT', { title: 'Inception', type: 'movie', year: '2010', playing: true, position: 43, waiting: 'still?' });
check('playing again: no reason kept', (await c(B, `rooms/${room.code}?rev=0`)).data?.state?.waiting === '');
const again = (await c(B, `rooms/${room.code}/join?msg=`, 'POST', {})).data;
check("joining again shows the group's lines", again?.chat?.history?.some((m) => m.text === 'Starting now'));

// The switches: watch along now on unless turned off; auto-join off unless turned on.
const switches = (await ask(A, '/api/online?light=1')).data?.switches;
check('watch along on by default, auto-join off', switches?.along === true && switches.autoJoin === false, JSON.stringify(switches));
await ask(A, '/api/online', 'POST', { action: 'switches', autoJoin: true });
const after = (await ask(A, '/api/online?light=1')).data?.switches;
check('auto-join alone turns on, the others stay', after?.autoJoin === true && after.along === true && after.share === true);
await ask(A, '/api/online', 'POST', { action: 'switches', ...after, along: false });
check('watch along turned off stays off', (await ask(A, '/api/online?light=1')).data?.switches?.along === false);
await ask(A, '/api/online', 'POST', { action: 'switches', ...after, along: true, autoJoin: false });

// The feed and the library are sent 60 and 90 s after joining.
const left = 100_000 - (Date.now() - started);
if (left > 0) {
	console.log(`… waiting ${Math.round(left / 1000)} s for the feed and the watched list`);
	await wait(left);
}
const feed = (await c(B, 'activity')).data?.friends?.find((f) => f.id === ann.id);
const bad = feed?.items?.find((i) => i.title === 'Breaking Bad');
check('the feed has the episode watched last', bad?.season === 1 && bad.episode === 3, JSON.stringify(bad));
check('and it is the newest in the feed', feed?.items?.[0]?.title === 'Breaking Bad');
const library = (await c(B, `people/${ann.id}/library`)).data;
check("Ann's library: her watched titles, with year and kind", library?.total >= 3 && library.items.some((i) => i.title === 'Fight Club' && i.year === '1999' && i.type === 'movie'), JSON.stringify(library?.items?.slice(0, 3)));
check('best rated first', library?.items?.[0]?.rating === 9, String(library?.items?.[0]?.rating));
check('only shows', (await c(B, `people/${ann.id}/library?type=tv`)).data?.items?.every((i) => i.type === 'tv'));
check('by name', (await c(B, `people/${ann.id}/library?q=fight`)).data?.items?.length === 1);
const profile2 = (await c(B, `people/${ann.id}/profile`)).data;
check('profile counts and highest rated', profile2?.counts?.total >= 3 && profile2.top?.[0]?.title === 'Fight Club' && profile2.recent?.length > 0, JSON.stringify(profile2?.counts));

console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
