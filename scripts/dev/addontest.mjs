// Stremio addons (src/lib/server/sources/addons.ts) against pretend addons on 127.0.0.1:8812,
// plus the real Torrentio and Cinemeta, through the built server on 5298. Streams, then lists
// (catalogs) as Browse rows.
//
//   1. A TEST library (never the real one) with a TMDB key in its settings (for IMDb ids).
//   2. Start the built server:
//        CATALOG_DB=<test library.db> PORT=5298 HOST=127.0.0.1 ORIGIN=http://127.0.0.1:5298 node build/index.js
//   3. node scripts/dev/addontest.mjs
import { createServer } from 'node:http';

const CATALOG = 'http://127.0.0.1:5298';
const PRETEND = 8812;
const HERE = `http://127.0.0.1:${PRETEND}`;
let failed = 0;
const check = (name, ok, extra = '') => {
	if (!ok) failed++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

/* ---------------------------------------------------------------- the pretend addons */

const manifest = (id, extra = {}) => ({ id, name: id, version: '1.0.0', resources: ['stream'], types: ['movie', 'series'], idPrefixes: ['tt'], catalogs: [], ...extra });
const asked = [];
// Interstellar is tt0816692 (TMDB 157336); Breaking Bad S1E1 is tt0903747:1:1 (TMDB 1396).
const STREAMS = {
	'plain/movie/tt0816692': [
		{ name: '[RD download] Plain\n1080p', title: 'Interstellar.2014.1080p.BluRay.x264.AAC', url: 'https://files.example/not-ready.mp4' },
		{ name: 'Plain\n1080p', title: 'Interstellar.2014.1080p.BluRay.DTS-HD.x264', url: 'https://files.example/dts.mkv' },
		{ name: '[RD+] Plain\n1080p', title: 'Interstellar.2014.1080p.BluRay.x264.AAC5.1\n💾 3.1 GB', url: 'https://files.example/good.mp4' },
		{ name: 'Plain\n720p', title: 'Interstellar.2014.720p.WEB.AAC', url: 'https://files.example/720.mp4' },
		{
			name: 'Plain\n4K',
			title: 'Interstellar.2014.2160p.WEB.H265.AAC',
			url: 'https://hls.example/master.m3u8',
			behaviorHints: { proxyHeaders: { request: { Referer: 'https://hls.example/' } } }
		},
		{ name: 'Plain', title: 'Trailer', ytId: 'abc' }
	],
	'plain/series/tt0903747:1:1': [{ name: 'Plain\n1080p', title: 'Breaking.Bad.S01E01.1080p.AAC', url: 'https://files.example/bb.mp4' }],
	'tmdb/movie/tmdb:157336': [{ name: 'Tmdb\n1080p', title: 'Interstellar 1080p AAC', url: 'https://files.example/tmdb.mp4' }],
	'torrents/movie/tt0816692': [{ name: 'Torrents\n1080p', title: 'Interstellar.2014.1080p.x264.AAC\n👤 50 💾 2 GB', infoHash: 'a'.repeat(40) }]
};
const pretend = createServer((req, res) => {
	const path = decodeURIComponent(new URL(req.url, HERE).pathname).replace(/^\//, '');
	asked.push(path);
	const json = (body, status = 200) => {
		res.writeHead(status, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(body));
	};
	if (path === 'plain/manifest.json') return json(manifest('Plain'));
	if (path === 'tmdb/manifest.json') return json(manifest('Tmdb', { idPrefixes: ['tmdb:'], types: ['movie'] }));
	if (path === 'torrents/manifest.json') return json(manifest('Torrents'));
	if (path === 'conf/manifest.json') return json(manifest('Conf', { behaviorHints: { configurable: true, configurationRequired: true } }));
	if (path === 'lists/manifest.json')
		return json(
			manifest('Lists', {
				resources: ['catalog'],
				catalogs: [
					{ type: 'movie', id: 'picks', name: 'Picks', extra: [{ name: 'skip' }] },
					{ type: 'series', id: 'shows', name: 'Show picks' },
					{ type: 'movie', id: 'find', name: 'Find', extra: [{ name: 'search', isRequired: true }] },
					{ type: 'tv', id: 'channels', name: 'Channels' }
				]
			})
		);
	// Picks: three on the first page (one TMDB can't know), one more after skip=3.
	if (path === 'lists/catalog/movie/picks.json') return json({ metas: [{ id: 'tt0816692' }, { id: 'tt0137523' }, { id: 'kitsu:1' }] });
	if (path === 'lists/catalog/movie/picks/skip=3.json') return json({ metas: [{ id: 'tt0110912' }] });
	if (path === 'lists/catalog/movie/picks/skip=6.json') return json({ metas: [] });
	if (path === 'lists/catalog/series/shows.json') return json({ metas: [{ id: 'tt0903747' }, { id: 'tmdb:1399' }] });
	if (path === 'subs/manifest.json') return json(manifest('Subs', { resources: ['subtitles'] }));
	if (path === 'live/manifest.json') return json(manifest('Live', { types: ['tv'], idPrefixes: ['live:'] }));
	const stream = path.match(/^(\w+)\/stream\/(.+)\.json$/);
	if (stream) return json({ streams: STREAMS[`${stream[1]}/${stream[2]}`] ?? [] });
	json({ error: 'no' }, 404);
});
await new Promise((done) => pretend.listen(PRETEND, '127.0.0.1', done));

/* ---------------------------------------------------------------- Catalog */

async function action(name, fields) {
	const r = await fetch(`${CATALOG}/settings/services?/${name}`, {
		method: 'POST',
		headers: { Origin: CATALOG, 'x-sveltekit-action': 'true', 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(fields)
	});
	const answer = await r.json().catch(() => null);
	const data = answer?.data ? JSON.parse(answer.data) : null;
	const out = {};
	if (data) for (const [k, i] of Object.entries(data[0])) out[k] = data[i];
	return { type: answer?.type, ...out };
}
const stream = async (shareKey) => (await fetch(`${CATALOG}/api/watch/stream?share_key=${encodeURIComponent(shareKey)}&fid=-100&refresh=1`)).json();

// Install links.
let r = await action('addAddon', { addonLink: 'not a link' });
check('a non-link is refused', r.type === 'failure' && /isn't an addon link/.test(r.addonError), r.addonError);
r = await action('addAddon', { addonLink: 'https://v3-cinemeta.strem.io/manifest.json' });
check('Cinemeta (lists only) is accepted', r.type === 'success' && /Cinemeta added/.test(r.addonOk), r.addonOk ?? r.addonError);
await action('removeAddon', { key: (await import('node:crypto')).createHash('sha1').update('https://v3-cinemeta.strem.io').digest('hex').slice(0, 8) });
r = await action('addAddon', { addonLink: `${HERE}/conf/manifest.json` });
check('an addon still to be set up is refused', r.type === 'failure' && /set up on its own page/.test(r.addonError), r.addonError);
r = await action('addAddon', { addonLink: `${HERE}/subs/manifest.json` });
check('a subtitles-only addon is refused', r.type === 'failure' && /no streams or lists/.test(r.addonError), r.addonError);
r = await action('addAddon', { addonLink: `${HERE}/live/manifest.json` });
check('a live-TV addon is refused', r.type === 'failure' && /other things/.test(r.addonError), r.addonError);
r = await action('addAddon', { addonLink: `${HERE}/plain/manifest.json` });
check('Plain is added', r.type === 'success' && /Plain added/.test(r.addonOk), r.addonOk ?? r.addonError);
r = await action('addAddon', { addonLink: `${HERE}/tmdb/manifest.json` });
check('Tmdb is added', r.type === 'success', r.addonOk ?? r.addonError);
r = await action('addAddon', { addonLink: `${HERE}/torrents/manifest.json` });
check('Torrents is added', r.type === 'success', r.addonOk ?? r.addonError);
r = await action('addAddon', { addonLink: 'stremio://torrentio.strem.fun/manifest.json' });
check('real Torrentio is added from a stremio:// link', r.type === 'success' && /Torrentio/.test(r.addonOk), r.addonOk ?? r.addonError);
r = await action('addAddon', { addonLink: `${HERE}/plain/manifest.json` });
check('adding Plain again keeps one', r.type === 'success');

const page = await (await fetch(`${CATALOG}/settings/services`)).text();
check('Settings lists the addons by site, not full link', page.includes('Torrentio') && page.includes('torrentio.strem.fun') && !page.includes('/plain/manifest'), '');
check('Settings never shows an addon link', !page.includes(`${HERE}/plain`));

// Copies, through the film list.
const resolved = await (await fetch(`${CATALOG}/api/watch/resolve?title=Interstellar&type=movie&year=2014&nostream=1`)).json().catch(() => null);
const names = (resolved?.files ?? []).map((f) => f.name);
check('the film lists each addon\'s copies', ['Plain 1080p', 'Plain 4K', 'Tmdb 1080p', 'Torrents 1080p', 'Torrentio 4K'].every((n) => names.includes(n)), names.join(', '));
const plain = (resolved?.files ?? []).find((f) => f.name === 'Plain 1080p');
const shareOf = (name) => (resolved?.files ?? []).find((f) => f.name === name)?.shareKey ?? '';
check('a share key holds no address', plain && /^addon:[a-f0-9]{8}:1080p:movie:157336:0:0$/.test(plain.shareKey), plain?.shareKey);

// Streams.
let s = await stream(shareOf('Plain 1080p'));
check('1080p: the ready AAC file, not the downloading or DTS one', s.url === 'https://files.example/good.mp4', JSON.stringify(s));
s = await stream(shareOf('Plain 4K'));
check('4K: the playlist through the relay', s.url === `/api/watch/relay?u=${encodeURIComponent('https://hls.example/master.m3u8')}`, JSON.stringify(s));
const relay = await fetch(`${CATALOG}${s.url}`);
check('the relay accepts the addon\'s server', relay.status !== 403, String(relay.status));
s = await stream(shareOf('Tmdb 1080p'));
check('a TMDB-id addon is asked by tmdb:', s.url === 'https://files.example/tmdb.mp4' && asked.includes('tmdb/stream/movie/tmdb:157336.json'), JSON.stringify(s));
s = await stream(shareOf('Torrents 1080p'));
check('torrents without debrid say so', !s.url && /debrid service/.test(s.debug), JSON.stringify(s));
s = await stream(shareOf('Torrentio 1080p'));
check('real Torrentio without debrid says so', !s.url && /only has torrents/.test(s.debug), JSON.stringify(s));

const show = (await fetch(`${CATALOG}/api/watch/stream?share_key=${encodeURIComponent(shareOf('Plain 1080p').replace(':movie:157336:0:0', ':tv:1396:1:1'))}&fid=-100&refresh=1`).then((x) => x.json()));
check('an episode is asked as series/tt…:1:1', show.url === 'https://files.example/bb.mp4' && asked.includes('plain/stream/series/tt0903747:1:1.json'), JSON.stringify(show));

// Order and removal.
const keyOfPlain = plain.shareKey.split(':')[1];
const keyOfTorrentio = shareOf('Torrentio 1080p').split(':')[1];
await action('raiseAddon', { key: keyOfTorrentio });
const again = await (await fetch(`${CATALOG}/api/watch/resolve?title=Interstellar&type=movie&year=2014&nostream=1`)).json();
const order = again.files.map((f) => f.name).filter((n) => /^(Torrents|Torrentio) 1080p$/.test(n));
check('Move up puts Torrentio before Torrents', order[0] === 'Torrentio 1080p', order.join(', '));
for (const name of ['Plain 1080p', 'Tmdb 1080p', 'Torrents 1080p', 'Torrentio 1080p']) await action('removeAddon', { key: (again.files.find((f) => f.name === name)?.shareKey ?? '').split(':')[1] });
s = await stream(`addon:${keyOfPlain}:1080p:movie:157336:0:0`);
check('a removed addon\'s copy says so', !s.url && /removed/.test(s.debug), JSON.stringify(s));
const last = await (await fetch(`${CATALOG}/api/watch/resolve?title=Interstellar&type=movie&year=2014&nostream=1`)).json();
check('no addon copies are left', !last.files.some((f) => /^addon:/.test(f.shareKey ?? '')));
check('Settings says None', />None</.test(await (await fetch(`${CATALOG}/settings/services`)).text()));

/* ---------------------------------------------------------------- lists */

r = await action('addAddon', { addonLink: 'https://v3-cinemeta.strem.io/manifest.json' });
r = await action('addAddon', { addonLink: `${HERE}/lists/manifest.json` });
check('Lists (lists only) is added', r.type === 'success', r.addonOk ?? r.addonError);
const services = await (await fetch(`${CATALOG}/settings/services`)).text();
check('Settings says how many lists', services.includes('2 lists in Browse'), '');
const browseData = async (search = '') => {
	const r = await fetch(`${CATALOG}/browse/__data.json${search}`);
	return r.text();
};
const all = await browseData();
check('Browse has the Picks row', all.includes('Picks · Lists'), '');
check('Browse has the Show picks row', all.includes('Show picks · Lists'), '');
check('the search-only and channel lists are left out', !all.includes('Find · Lists') && !all.includes('Channels'), '');
check("Cinemeta's lists are rows too", /Popular · Cinemeta/.test(all), '');
check('Picks has Interstellar and Fight Club (kitsu left out)', all.includes('Interstellar') && all.includes('Fight Club'), '');
const films = await browseData('?cat=movies');
check('the Films tab has Picks but not Show picks', films.includes('Picks · Lists') && !films.includes('Show picks · Lists'), '');
const filtered = await browseData('?genre=18');
check('a genre filter leaves the addon rows out', !filtered.includes('Picks · Lists'), '');
const key = (await import('node:crypto')).createHash('sha1').update(`${HERE}/lists`).digest('hex').slice(0, 8);
const more = async (n) => (await fetch(`${CATALOG}/api/browse?cat=${encodeURIComponent(`addon~${key}~movie~picks`)}&page=${n}`)).json();
const two = await more(2);
check('Show more asks skip=3 and gets Pulp Fiction', two.results?.length === 1 && two.results[0].title === 'Pulp Fiction' && asked.includes('lists/catalog/movie/picks/skip=3.json'), JSON.stringify(two.results?.map((x) => x.title)));
const three = await more(3);
check('then the list ends', three.results?.length === 0, '');
const shows = await (await fetch(`${CATALOG}/api/browse?cat=${encodeURIComponent(`addon~${key}~series~shows`)}&page=1`)).json();
check('shows by IMDb and TMDB id both come through', shows.results?.map((x) => x.sourceId).join(',') === 'tv:1396,tv:1399', shows.results?.map((x) => x.sourceId).join(','));
const noPages = await (await fetch(`${CATALOG}/api/browse?cat=${encodeURIComponent(`addon~${key}~series~shows`)}&page=2`)).json();
check('a list without skip has no Show more pages', noPages.results?.length === 0, '');
check('list-only addons give no copies', !(await (await fetch(`${CATALOG}/api/watch/resolve?title=Interstellar&type=movie&year=2014&nostream=1`)).json()).files.some((f) => /^(Lists|Cinemeta) /.test(f.name)));
for (const k of [key, (await import('node:crypto')).createHash('sha1').update('https://v3-cinemeta.strem.io').digest('hex').slice(0, 8)]) await action('removeAddon', { key: k });
check('removed, the rows go', !(await browseData()).includes('· Lists'), '');

pretend.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
