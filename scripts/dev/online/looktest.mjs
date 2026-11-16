// Profile looks (2026-11-15): banner pictures, name styles, and the My profile button's /friends/me,
// through two test Catalogs on 5297 (A) and 5301 (B) and the meeting point run locally
// (cloud/README.md). Libraries: two EMPTY test ones (never the real library), with `onlineUrl` set to
// the local server. Started with BODY_SIZE_LIMIT=64M, as the desktop app has.
//   node scripts/dev/online/looktest.mjs <A's library.db> <B's library.db> [server address]
import { DatabaseSync } from 'node:sqlite';

const A = 'http://127.0.0.1:5297', B = 'http://127.0.0.1:5301';
const [, , fileA, fileB, server = 'http://127.0.0.1:8799'] = process.argv;
for (const f of [fileA, fileB]) if (!f || /AppData[\\/]Roaming[\\/]Catalog/i.test(f)) throw new Error('Two test libraries, please');
for (const f of [fileA, fileB]) {
	const db = new DatabaseSync(f);
	const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
	set.run('setupDone', '1');
	set.run('onlineUrl', server);
	if (!db.prepare("SELECT 1 FROM profiles WHERE name = 'Dad'").get()) db.prepare("INSERT INTO profiles (name, color) VALUES ('Dad', '#5b8def')").run();
	db.close();
}

let failed = 0;
const check = (name, ok, extra = '') => {
	if (!ok) failed++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};
const DAD = { 'User-Agent': 'CatalogTV/1.0 (test)', Cookie: 'catalog_profile=1' };
async function ask(base, path, method = 'GET', body, headers = {}) {
	const r = await fetch(base + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
	return { status: r.status, headers: r.headers, data: await r.json().catch(() => null) };
}
const c = (base, path, method, body, headers) => ask(base, `/api/online/c/${path}`, method, body, headers);

for (const [base, name] of [[A, 'Ann'], [B, 'Ben']]) check(`${name} joins`, (await ask(base, '/api/online', 'POST', { action: 'connect', join: 'TESTJOIN', name })).status === 200);
const code = (await c(A, 'friends/code', 'POST', {})).data?.code;
check('Ben adds Ann', (await c(B, 'friends/add', 'POST', { code })).status === 200);
const ann = (await c(B, 'friends')).data?.friends?.find((f) => f.name === 'Ann');
const annMe = (await c(A, 'friends')).data?.me;
check('ids known', Boolean(ann?.id && annMe?.id === ann.id));

// /friends/me goes to your own profile.
const me = await fetch(`${A}/friends/me`, { redirect: 'manual' });
check('/friends/me sends you to your own profile', me.status === 307 && me.headers.get('location') === `/friends/${ann.id}`, `${me.status} ${me.headers.get('location')}`);
const dadMe = await fetch(`${A}/friends/me`, { redirect: 'manual', headers: DAD });
check("Dad's /friends/me is his own, not Ann's", dadMe.status === 307 && dadMe.headers.get('location') !== `/friends/${ann.id}`, String(dadMe.headers.get('location')));

// A banner (any bytes will do: the server only checks it's a picture's data: address) and a name style.
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40_000, 7)]);
const banner = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
const style = { font: 'pacifico', effect: 'gradient', colors: ['#FF7EB3', '#7afcff', '#000000'] };
const saved = await c(A, 'profile', 'PUT', { bio: 'Hi', color: '#3366cc', favorites: [], nameStyle: style, banner });
check('Ann saves a banner and a name style', saved.status === 200, JSON.stringify(saved.data));
let seen = (await c(B, `people/${ann.id}/profile`)).data;
check('her profile has the banner number', seen?.banner > 0, String(seen?.banner));
check('her name style, cleaned (two colors, small letters)', JSON.stringify(seen?.nameStyle) === JSON.stringify({ font: 'pacifico', effect: 'gradient', colors: ['#ff7eb3', '#7afcff'] }), JSON.stringify(seen?.nameStyle));
const card = (await c(B, 'friends')).data?.friends?.find((f) => f.id === ann.id);
check("the Friends page's card has her name style", card?.nameStyle?.font === 'pacifico');

const picture = await fetch(`${B}/api/online/banner/${ann.id}?v=${seen.banner}`);
const bytes = Buffer.from(await picture.arrayBuffer());
check('Ben sees her banner picture', picture.status === 200 && picture.headers.get('content-type') === 'image/jpeg' && bytes.equals(jpeg), `${picture.status} ${bytes.length}`);
const stranger = await fetch(`${A}/api/online/banner/${ann.id}?v=${seen.banner}`, { headers: DAD });
check('Dad (not her friend) gets no banner', stranger.status === 404, String(stranger.status));
const own = await fetch(`${A}/api/online/banner/${ann.id}?v=${seen.banner}`);
check('Ann sees her own', own.status === 200);

// An older Catalog's save (no nameStyle, no banner) keeps both.
check('a save without them', (await c(A, 'profile', 'PUT', { bio: 'Hi again', color: '', favorites: [] })).status === 200);
seen = (await c(B, `people/${ann.id}/profile`)).data;
check('keeps the banner and the style', seen?.banner > 0 && seen?.nameStyle?.font === 'pacifico' && seen.bio === 'Hi again');

// Refused: too big, not a picture.
const huge = `data:image/jpeg;base64,${Buffer.alloc(600_000, 1).toString('base64')}`;
// (413 from the body limit, 400 from the banner's own; the page makes them smaller before sending.)
const hugeAnswer = (await c(A, 'profile', 'PUT', { bio: '', favorites: [], banner: huge })).status;
check('a banner over the limit is refused', hugeAnswer === 400 || hugeAnswer === 413, String(hugeAnswer));
check('a banner that is not a picture is refused', (await c(A, 'profile', 'PUT', { bio: '', favorites: [], banner: 'data:text/html;base64,PGI+' })).status === 400);
const gif = `data:image/gif;base64,${Buffer.from('GIF89a' + 'x'.repeat(5000)).toString('base64')}`;
check('a GIF banner is taken', (await c(A, 'profile', 'PUT', { bio: '', favorites: [], banner: gif, nameStyle: style })).status === 200);
const gifSeen = (await c(B, `people/${ann.id}/profile`)).data;
const gifPicture = await fetch(`${B}/api/online/banner/${ann.id}?v=${gifSeen.banner}`);
check('and served as a GIF', gifPicture.headers.get('content-type') === 'image/gif');

// Taken away again; a plain name.
check('banner and style taken away', (await c(A, 'profile', 'PUT', { bio: '', favorites: [], banner: '', nameStyle: { font: '', effect: 'solid', colors: [] } })).status === 200);
seen = (await c(B, `people/${ann.id}/profile`)).data;
check('no banner, no style', seen?.banner === 0 && seen?.nameStyle === null, JSON.stringify({ b: seen?.banner, s: seen?.nameStyle }));
check('its picture is gone', (await fetch(`${B}/api/online/banner/${ann.id}?v=1`)).status === 404);

// The My profile button: the layout knows who you are (the page's data has it). (A request with no
// profile cookie is whichever profile used this computer last, so Ann's or Dad's.)
const page = await (await fetch(`${A}/`, { headers: { Cookie: 'catalog_profile=0' } })).text();
const linked = page.match(/href="\/friends\/([A-Z0-9]{16}|me)" class="my-profile/)?.[1];
check('the library page has the My profile button, to your own', linked === ann.id, String(linked));

console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
