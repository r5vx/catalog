// Debrid (src/lib/server/sources/debrid.ts) against a pretend Torrentio and pretend Real-Debrid,
// TorBox, AllDebrid and Premiumize, all on 127.0.0.1:8811, through the built server on 5297.
// No real debrid account is used. Torrentio's real lists for Interstellar and Breaking Bad S1E1
// are fetched once (2 asks) and served back, so the ranking is checked on real release names.
//
//   1. A TEST library (never the real one) with a TMDB key in its settings (for IMDb ids).
//   2. Start the built server with the pretend addresses:
//        CATALOG_DB=<test library.db> CATALOG_DEBRID_TEST_BASE=http://127.0.0.1:8811
//        CATALOG_TORRENTIO_BASE=http://127.0.0.1:8811 PORT=5297 HOST=127.0.0.1
//        ORIGIN=http://127.0.0.1:5297 BODY_SIZE_LIMIT=64M node build/index.js
//   3. node scripts/dev/debridtest.mjs
import { createServer } from 'node:http';

const CATALOG = 'http://127.0.0.1:5297';
const PRETEND = 8811;
const GOOD = 'good-key';
let failed = 0;
const check = (name, ok, extra = '') => {
	if (!ok) failed++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

/* ---------------------------------------------------------------- Torrentio's real lists */

const OPTIONS = 'providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex|qualityfilter=480p,scr,cam,unknown';
const realList = async (path) => {
	const r = await fetch(`https://torrentio.strem.fun/${OPTIONS}/stream/${path}.json`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
	return (await r.json()).streams ?? [];
};
const lists = { 'movie/tt0816692': await realList('movie/tt0816692'), 'series/tt0903747:1:1': await realList('series/tt0903747:1:1') };
check('Torrentio lists fetched', lists['movie/tt0816692'].length > 20 && lists['series/tt0903747:1:1'].length > 3, `${lists['movie/tt0816692'].length} / ${lists['series/tt0903747:1:1'].length}`);
const byHash = new Map(Object.values(lists).flat().map((s) => [s.infoHash.toLowerCase(), s]));
const label = (hash) => byHash.get(hash)?.title?.split('\n')[0] ?? hash;

/* ---------------------------------------------------------------- the pretend services */

/** Which hashes each pretend service has ready; what was asked of it. */
const state = { cached: new Set(), asked: [], deleted: [], checked: [] };
const torrents = new Map();
let nextId = 1;
const fileList = (hash) => {
	const s = byHash.get(hash);
	const name = s?.behaviorHints?.filename || 'video.mkv';
	// The file Torrentio means at its place, with a sample and a text file around it.
	const files = [];
	const at = Number.isInteger(s?.fileIdx) ? s.fileIdx : 0;
	for (let i = 0; i <= Math.max(at, 1); i++) files.push(i === at ? { name, size: 2e9 } : { name: i % 2 ? 'Sample.mkv' : 'readme.txt', size: 1e6 });
	return files;
};
const linkFor = (hash, name) => `http://127.0.0.1:${PRETEND}/files/${hash}/${encodeURIComponent(name)}`;

const json = (res, body, status = 200) => {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
};
const bodyOf = (req) => new Promise((done) => {
	let raw = '';
	req.on('data', (d) => (raw += d)).on('end', () => done(new URLSearchParams(raw)));
});
const hashOfMagnet = (m) => (m ?? '').match(/btih:([a-f0-9]{40})/i)?.[1]?.toLowerCase() ?? '';

const pretend = createServer(async (req, res) => {
	const url = new URL(req.url, `http://127.0.0.1:${PRETEND}`);
	const p = decodeURIComponent(url.pathname);
	const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/, '');
	const form = req.method === 'POST' ? await bodyOf(req) : new URLSearchParams();
	state.asked.push(`${req.method} ${p}`);

	// Torrentio
	const stream = p.match(/^\/(.+)\/stream\/(movie|series)\/(.+)\.json$/);
	if (stream) return json(res, { streams: lists[`${stream[2]}/${stream[3]}`] ?? [] });

	// Real-Debrid
	if (p.startsWith('/rd/')) {
		if (bearer !== GOOD) return json(res, { error: 'bad_token', error_code: 8 }, 401);
		if (p === '/rd/user') return json(res, { username: 'tester', type: 'premium', expiration: '2027-01-01T00:00:00.000Z' });
		if (p === '/rd/torrents/addMagnet') {
			const id = `RD${nextId++}`;
			torrents.set(id, { hash: hashOfMagnet(form.get('magnet')), selected: null });
			return json(res, { id, uri: '' }, 201);
		}
		const info = p.match(/^\/rd\/torrents\/info\/(\w+)$/);
		if (info) {
			const t = torrents.get(info[1]);
			const files = fileList(t.hash).map((f, i) => ({ id: i + 1, path: `/${f.name}`, bytes: f.size, selected: t.selected === i + 1 ? 1 : 0 }));
			if (t.selected === null) return json(res, { id: info[1], status: 'waiting_files_selection', files, links: [] });
			const ready = state.cached.has(t.hash);
			return json(res, { id: info[1], status: ready ? 'downloaded' : 'downloading', files, links: ready ? [`https://real-debrid.com/d/${info[1]}`] : [] });
		}
		const select = p.match(/^\/rd\/torrents\/selectFiles\/(\w+)$/);
		if (select) {
			torrents.get(select[1]).selected = Number(form.get('files'));
			res.writeHead(204).end();
			return;
		}
		const del = p.match(/^\/rd\/torrents\/delete\/(\w+)$/);
		if (del) {
			state.deleted.push(torrents.get(del[1]).hash);
			res.writeHead(204).end();
			return;
		}
		if (p === '/rd/unrestrict/link') {
			const t = torrents.get(form.get('link').split('/').pop());
			const file = fileList(t.hash)[t.selected - 1];
			return json(res, { download: linkFor(t.hash, file.name) });
		}
	}

	// TorBox
	if (p.startsWith('/tb/')) {
		if (bearer !== GOOD) return json(res, { success: false, detail: 'Invalid API key', error: 'AUTH_ERROR' }, 401);
		if (p === '/tb/user/me') return json(res, { success: true, data: { email: 'tester@example.com', plan: 2, premium_expires_at: '2027-01-01T00:00:00Z' } });
		if (p === '/tb/torrents/checkcached') {
			const hashes = (url.searchParams.get('hash') ?? '').split(',');
			state.checked = hashes;
			return json(res, { success: true, data: hashes.filter((h) => state.cached.has(h)).map((hash) => ({ hash, name: label(hash) })) });
		}
		if (p === '/tb/torrents/createtorrent') {
			const id = nextId++;
			torrents.set(String(id), { hash: hashOfMagnet(form.get('magnet')) });
			return json(res, { success: true, data: { torrent_id: id, hash: '', auth_id: '' } });
		}
		if (p === '/tb/torrents/mylist') {
			const t = torrents.get(url.searchParams.get('id'));
			return json(res, { success: true, data: { id: Number(url.searchParams.get('id')), files: fileList(t.hash).map((f, i) => ({ id: i, name: `Folder/${f.name}`, short_name: f.name, size: f.size })) } });
		}
		if (p === '/tb/torrents/requestdl') {
			if (url.searchParams.get('token') !== GOOD) return json(res, { success: false, detail: 'bad token' }, 401);
			const t = torrents.get(url.searchParams.get('torrent_id'));
			const file = fileList(t.hash)[Number(url.searchParams.get('file_id'))];
			return json(res, { success: true, data: linkFor(t.hash, file.name) });
		}
	}

	// AllDebrid (HTTP 200 with status "error" for a bad key, as AllDebrid does)
	if (p.startsWith('/ad/')) {
		if (url.searchParams.get('agent') !== 'catalog') return json(res, { status: 'error', error: { code: 'AUTH_MISSING_AGENT', message: 'agent missing' } });
		if (bearer !== GOOD) return json(res, { status: 'error', error: { code: 'AUTH_BAD_APIKEY', message: 'The auth apikey is invalid' } });
		if (p === '/ad/v4/user') return json(res, { status: 'success', data: { user: { username: 'tester', isPremium: true, premiumUntil: 1798761600 } } });
		if (p === '/ad/v4/magnet/upload') {
			const hash = hashOfMagnet(form.get('magnets[]'));
			const id = nextId++;
			torrents.set(String(id), { hash });
			return json(res, { status: 'success', data: { magnets: [{ id, hash, ready: state.cached.has(hash) }] } });
		}
		if (p === '/ad/v4/magnet/delete') {
			state.deleted.push(torrents.get(url.searchParams.get('id')).hash);
			return json(res, { status: 'success', data: { message: 'deleted' } });
		}
		if (p === '/ad/v4/magnet/files') {
			const id = url.searchParams.get('id[]');
			const t = torrents.get(id);
			const files = fileList(t.hash).map((f) => ({ n: f.name, s: f.size, l: `https://alldebrid.com/f/${t.hash}/${encodeURIComponent(f.name)}` }));
			return json(res, { status: 'success', data: { magnets: [{ id: Number(id), files: [{ n: 'Folder', e: files }] }] } });
		}
		if (p === '/ad/v4/link/unlock') {
			const [, , hash, name] = new URL(url.searchParams.get('link')).pathname.split('/');
			return json(res, { status: 'success', data: { link: linkFor(hash, decodeURIComponent(name)) } });
		}
	}

	// Premiumize (the key as ?apikey=)
	if (p.startsWith('/pm/')) {
		if (url.searchParams.get('apikey') !== GOOD) return json(res, { status: 'error', message: 'Not logged in. Invalid api key' });
		if (p === '/pm/account/info') return json(res, { status: 'success', customer_id: 1234, premium_until: 1798761600 });
		if (p === '/pm/cache/check') {
			const items = url.searchParams.getAll('items[]');
			state.checked = items;
			return json(res, { status: 'success', response: items.map((h) => state.cached.has(h)) });
		}
		if (p === '/pm/transfer/directdl') {
			const hash = hashOfMagnet(form.get('src'));
			return json(res, { status: 'success', content: fileList(hash).map((f) => ({ path: `Folder/${f.name}`, size: f.size, link: linkFor(hash, f.name), stream_link: linkFor(hash, `${f.name}.transcoded.mp4`), transcode_status: 'finished' })) });
		}
	}
	json(res, { error: `no such pretend address: ${p}` }, 404);
});
await new Promise((done) => pretend.listen(PRETEND, '127.0.0.1', done));

/* ---------------------------------------------------------------- Catalog */

/** A Settings → Services form, sent the way the page sends it (as a SvelteKit action). */
async function action(name, fields) {
	const r = await fetch(`${CATALOG}/settings/services?/${name}`, {
		method: 'POST',
		headers: { Origin: CATALOG, 'x-sveltekit-action': 'true', 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(fields)
	});
	const answer = await r.json().catch(() => null);
	// (SvelteKit's devalue: data is a list, its first entry the object of indexes.)
	const data = answer?.data ? JSON.parse(answer.data) : null;
	const read = (i) => (data ? data[i] : undefined);
	const out = {};
	if (data) for (const [k, i] of Object.entries(data[0])) out[k] = read(i);
	return { type: answer?.type, ...out };
}
const stream = async (shareKey) => (await fetch(`${CATALOG}/api/watch/stream?share_key=${encodeURIComponent(shareKey)}&fid=-10&refresh=1`)).json();
const FILM = 'debrid:1080p:movie:157336:0:0'; // Interstellar
const FILM_4K = 'debrid:2160p:movie:157336:0:0';
const EPISODE = 'debrid:1080p:tv:1396:1:1'; // Breaking Bad S1E1
const reset = () => {
	state.asked = [];
	state.deleted = [];
	state.checked = [];
};

// Settings: refused keys, then each service saved.
for (const service of ['realdebrid', 'torbox', 'alldebrid', 'premiumize']) {
	const bad = await action('saveDebrid', { debridService: service, debridKey: 'wrong' });
	check(`${service}: a wrong key is refused, saying so`, bad.type === 'failure' && /refused|invalid|logged in/i.test(bad.debridError ?? ''), bad.debridError);
}
check('no key: refused', (await action('saveDebrid', { debridService: 'torbox', debridKey: '' })).type === 'failure');
check('an unknown service: refused', (await action('saveDebrid', { debridService: 'nope', debridKey: GOOD })).type === 'failure');

// TorBox: asks for many at once. The order it's asked in is Catalog's ranking.
let saved = await action('saveDebrid', { debridService: 'torbox', debridKey: GOOD });
check('TorBox key saved, with who it is', saved.type === 'success' && /tester@example\.com/.test(saved.debridOk ?? ''), saved.debridOk);
const page = await (await fetch(`${CATALOG}/settings/services`)).text();
check('Settings → Services shows TorBox on, and never the key', page.includes('TorBox key saved') && !page.includes(GOOD));

state.cached = new Set(byHash.keys());
reset();
let got = await stream(FILM);
const order = state.checked.map(label);
check('TorBox: Interstellar 1080p plays', /^http:\/\/127\.0\.0\.1:8811\/files\//.test(got.url ?? ''), got.url || got.debug);
console.log('     ranked first five:\n       ' + order.slice(0, 5).join('\n       '));
const asked = state.checked.map((h) => `${label(h)} ${byHash.get(h)?.behaviorHints?.filename ?? ''}`);
check('none with silent sound (TrueHD, DTS, DDP, AC3, Atmos)', asked.every((n) => !/truehd|dts|ddp|dd5|dd\+|e-?ac-?3|ac-?3|atmos/i.test(n)), asked.find((n) => /truehd|dts|ddp|dd5|e-?ac-?3|ac-?3|atmos/i.test(n)));
check('no REMUX', asked.every((n) => !/remux/i.test(n)));
check('only 1080p/720p for the 1080p copy', state.checked.every((h) => /1080p|720p/i.test(byHash.get(h)?.name ?? '')));
check('AAC/Opus (or YTS/YIFY) first', /aac|opus|yts|yify|\dch/i.test(asked[0] ?? ''), asked[0]);
const flagged = (h) => (byHash.get(h)?.title.match(/\p{Regional_Indicator}{2}/gu) ?? []).some((f) => f !== '🇬🇧' && f !== '🇯🇵');
const firstFlagged = state.checked.findIndex(flagged);
check('other-language releases only after every English one', firstFlagged === -1 || state.checked.slice(firstFlagged).every(flagged), `first at ${firstFlagged} of ${state.checked.length}`);
check('it played the first ready one', got.debug && got.url.includes(encodeURIComponent(byHash.get(state.checked[0])?.behaviorHints?.filename ?? '~')), got.debug);

reset();
got = await stream(FILM_4K);
check('TorBox: the 4K copy asks for 4K only', state.checked.length > 0 && state.checked.every((h) => /4k/i.test(byHash.get(h)?.name ?? '')), String(state.checked.length));
check('…never Dolby Vision without HDR', state.checked.every((h) => !/(^|[^a-z])dv([^a-z]|$)/i.test(byHash.get(h)?.title ?? '') || /hdr/i.test(byHash.get(h)?.title ?? '')));

reset();
state.cached = new Set();
got = await stream(FILM);
check('TorBox: nothing ready says so, adds nothing', !got.url && /ready/.test(got.debug ?? '') && !state.asked.some((a) => a.includes('createtorrent')), got.debug);

state.cached = new Set(byHash.keys());
reset();
got = await stream(EPISODE);
check('TorBox: Breaking Bad S1E1 plays the episode file, not the sample', /\.(mkv|mp4)$/i.test(decodeURIComponent(got.url ?? '')) && !/sample/i.test(got.url ?? ''), decodeURIComponent(got.url ?? got.debug));

// Real-Debrid: can't ask without adding. The first two not ready: deleted again, the third plays.
saved = await action('saveDebrid', { debridService: 'realdebrid', debridKey: GOOD });
check('Real-Debrid key saved', saved.type === 'success' && /premium until 2027-01-01/.test(saved.debridOk ?? ''), saved.debridOk);
reset();
state.cached = new Set(byHash.keys());
got = await stream(FILM); // (to learn the order)
const rdOrder = state.asked.filter((a) => a.includes('addMagnet')).length;
check('Real-Debrid: plays when the first is ready (one torrent added)', Boolean(got.url) && rdOrder === 1 && state.deleted.length === 0, `${rdOrder} added, ${state.deleted.length} deleted`);
const firstHash = new URL(got.url).pathname.split('/')[2];
reset();
state.cached = new Set([...byHash.keys()].filter((h) => h !== firstHash));
// Make the second one not ready either: find it by playing once more without the first.
got = await stream(FILM);
const secondHash = new URL(got.url).pathname.split('/')[2];
reset();
state.cached = new Set([...byHash.keys()].filter((h) => h !== firstHash && h !== secondHash));
got = await stream(FILM);
check('Real-Debrid: two not ready are deleted again, the third plays', Boolean(got.url) && state.deleted.length === 2 && state.deleted.includes(firstHash) && state.deleted.includes(secondHash), `${state.deleted.length} deleted`);
check('Real-Debrid: the right file was selected (not the sample)', !/sample|readme/i.test(decodeURIComponent(got.url ?? '')), decodeURIComponent(got.url ?? ''));
reset();
state.cached = new Set();
got = await stream(FILM);
const tries = state.asked.filter((a) => a.includes('addMagnet')).length;
check('Real-Debrid: nothing ready: at most 5 tried, all deleted', !got.url && tries === 5 && state.deleted.length === 5, `${tries} tried, ${state.deleted.length} deleted: ${got.debug}`);

// AllDebrid
saved = await action('saveDebrid', { debridService: 'alldebrid', debridKey: GOOD });
check('AllDebrid key saved', saved.type === 'success', saved.debridOk);
reset();
state.cached = new Set([...byHash.keys()].filter((h) => h !== firstHash));
got = await stream(EPISODE);
check('AllDebrid: episode plays (file tree read, link unlocked)', /^http:\/\/127\.0\.0\.1:8811\/files\//.test(got.url ?? '') && !/sample/i.test(got.url), got.url || got.debug);
reset();
got = await stream(FILM);
check('AllDebrid: the one not ready is deleted, the next plays', Boolean(got.url) && state.deleted.length === 1 && state.deleted[0] === firstHash, `${state.deleted.length} deleted`);

// Premiumize: its browser-ready copy when made.
saved = await action('saveDebrid', { debridService: 'premiumize', debridKey: GOOD });
check('Premiumize key saved', saved.type === 'success', saved.debridOk);
reset();
state.cached = new Set(byHash.keys());
got = await stream(FILM);
check("Premiumize: plays its browser-ready copy", /transcoded\.mp4$/.test(decodeURIComponent(got.url ?? '')), decodeURIComponent(got.url ?? got.debug));

check('Remove', (await action('removeDebrid', {})).type === 'success');
const off = await stream(FILM);
check('removed: the copy says debrid is off', !off.url && /off/i.test(off.debug ?? ''), off.debug);

pretend.close();
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
