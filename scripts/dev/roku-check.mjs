import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Run with node --test scripts/dev/roku-check.mjs. Mock upstream responses, not the Roku routes.
function route(name, mocks = {}) {
	const file = new URL(`../../src/routes/api/roku/${name}/+server.ts`, import.meta.url);
	const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
	});
	const { exports } = { exports: {} };
	const load = (id) => {
		if (id === '@sveltejs/kit') return {
			json: Response.json.bind(Response),
			error: (status, message) => { throw Object.assign(new Error(message), { status }); }
		};
		if (id in mocks) return mocks[id];
		throw new Error(`Missing test dependency: ${id}`);
	};
	new Function('exports', 'require', outputText)(exports, load);
	return exports.GET;
}

const base = 'http://catalog.test';
const cookie = 'catalog_profile=2; catalog_auth=synthetic-token';
const requestAt = (path) => {
	const url = new URL(path, base);
	return { url, request: new Request(url, { headers: { cookie, 'user-agent': 'CatalogTV/1.0 (Roku)' } }) };
};

const file = { fid: -1, source: 'Test source', shareKey: 'test:tv:42:1:1', quality: '1080p' };
const seasonOne = { season: 1, episode: 1, files: [file] };
const seasonTwo = { season: 2, episode: 1, files: [file] };

function playback(t, { episodes = [seasonOne, seasonTwo], address = '/api/test/media.m3u8', debug, playlist } = {}) {
	const fetched = [];
	const probed = [];
	t.mock.method(globalThis, 'fetch', async (addressToFetch, options) => {
		const url = new URL(addressToFetch);
		fetched.push({ url, cookie: new Headers(options.headers).get('cookie') });
		if (url.pathname === '/api/watch/resolve') return Response.json({ title: 'Fixture', episodes: { episodes } });
		if (url.pathname === '/api/watch/is-anime') return Response.json({ anime: false });
		if (url.pathname === '/api/watch/stream') return Response.json({ url: address, debug });
		if (url.pathname === '/api/watch/strip/prepare') return Response.json({});
		if (url.href === base + address && playlist) return new Response(playlist);
		return new Response('#EXTM3U\n#EXTINF:15,\npiece.ts\n');
	});
	const play = route('play', {
		'$lib/server/db/queries': { getWatchProgress: () => null },
		'$lib/watch': { pickFile: (files) => files[0] },
		'$lib/server/settings': { readSettings: () => ({}) },
		'$lib/server/tvEpisodes': { seasonEpisodes: () => Promise.resolve([{ episode: 1, runtime: 42 }]) },
		'$lib/server/rokuQualities': {
			rokuScreen: () => ({ height: 1080, fps1080: 60 }),
			qualitiesAt: async (...args) => { probed.push(args); return [2500, 1500]; }
		}
	});
	return { play: async (query = '') => (await play(requestAt(`/api/roku/play?title=Fixture&${query}`))).json(), fetched, probed };
}

test('play the requested episode; never substitute another for an unavailable selection', async (t) => {
	const { play, fetched } = playback(t, { episodes: [{ ...seasonOne, season: 0 }, seasonOne, seasonTwo, { ...seasonTwo, episode: 2, available: false }] });
	assert.equal((await play('season=2&episode=1')).season, 2);
	assert.equal((await play('season=0&episode=1')).season, 0);
	assert.equal((await play()).season, 1);
	fetched.length = 0;
	assert.match((await play('season=2&episode=2')).error ?? '', /episode/i);
	assert.ok(!fetched.some(({ url }) => url.pathname === '/api/watch/stream'));
});

test('direct MKV with a signed URL stays direct and does not use HLS probes', async (t) => {
	const address = 'https://media.test/show.MKV?sig=fixture';
	const { play, probed, fetched } = playback(t, { address });
	const plan = await play();
	assert.equal(plan.url, address);
	assert.equal(plan.format, 'mkv');
	assert.equal(plan.bif, null);
	assert.equal(probed.length, 0);
	assert.ok(fetched.every(({ url }) => url.origin === base));
});

test('an opaque download can use the resolved filename', async (t) => {
	const address = 'https://media.test/download/123';
	const { play } = playback(t, { address, debug: 'Fixture - 01.mkv' });
	assert.equal((await play()).format, 'mkv');
});

test('provider HLS stays direct and neither Roku probe forwards the Catalog cookie', async (t) => {
	const address = 'https://media.test/hls/fixture.m3u8';
	const { play, probed, fetched } = playback(t, { address });
	const plan = await play();
	assert.equal(plan.url, address);
	assert.equal(plan.format, 'hls');
	assert.deepEqual(plan.headers, []);
	assert.equal(probed[0][1].cookie, undefined);
	assert.equal(fetched.find(({ url }) => url.origin !== base)?.cookie, null);
	assert.equal(fetched.find(({ url }) => url.pathname === '/api/watch/resolve')?.cookie, cookie);
});

test('Catalog HLS keeps the profile cookie and bandwidth fallback', async (t) => {
	const { play, probed, fetched } = playback(t, {
		playlist: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000\nhttps://media.test/child.m3u8\n'
	});
	const plan = await play();
	assert.equal(plan.url, base + '/api/test/media.m3u8');
	assert.equal(plan.format, 'hls');
	assert.equal(probed[0][1].cookie, cookie);
	assert.equal(fetched.find(({ url }) => url.hostname === 'media.test').cookie, null);
	assert.deepEqual(plan.qualities, [2500, 1500]);
});

test('Showbox HLS still gets the Roku AAC wrapper', async (t) => {
	const address = 'https://cdn.shegu.net/a/master.m3u8';
	const { play } = playback(t, { address, episodes: [{ ...seasonOne, files: [{ ...file, source: undefined }] }] });
	const plan = await play();
	assert.equal(new URL(plan.url).pathname, '/api/roku/hls');
	assert.equal(new URL(plan.fallback).searchParams.get('all'), '1');
});

test('a wrapped media playlist resolves its segments and URI attributes against the upstream playlist', async (t) => {
	t.mock.method(globalThis, 'fetch', async () => new Response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:10,\nchunk.m4s\n'));
	const getPlaylist = route('hls');
	for (const all of ['', '&all=1']) {
		const response = await getPlaylist(requestAt(`/api/roku/hls?u=https://cdn.shegu.net/a/index.m3u8${all}`));
		assert.equal(await response.text(), '#EXTM3U\n#EXT-X-MAP:URI="https://cdn.shegu.net/a/init.mp4"\n#EXTINF:10,\nhttps://cdn.shegu.net/a/chunk.m4s\n');
	}
});

test('the Showbox wrapper still excludes Dolby variants and resolves AAC audio URLs', async (t) => {
	t.mock.method(globalThis, 'fetch', async () => new Response([
		'#EXTM3U',
		'#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",URI="aac.m3u8"',
		'#EXT-X-STREAM-INF:BANDWIDTH=3000000,CODECS="avc1,ec-3"',
		'dolby.m3u8',
		'#EXT-X-STREAM-INF:BANDWIDTH=2200000,CODECS="avc1,mp4a.40.2",AUDIO="aac"',
		'best.m3u8',
		'#EXT-X-STREAM-INF:BANDWIDTH=1100000,CODECS="avc1,mp4a.40.2",AUDIO="aac"',
		'lower.m3u8'
	].join('\n')));
	const getPlaylist = route('hls');
	const path = '/api/roku/hls?u=https://cdn.shegu.net/a/index.m3u8';
	const text = await (await getPlaylist(requestAt(path))).text();
	assert.match(text, /https:\/\/cdn\.shegu\.net\/a\/aac.m3u8/);
	assert.match(text, /https:\/\/cdn\.shegu\.net\/a\/best.m3u8/);
	assert.doesNotMatch(text, /dolby.m3u8|lower.m3u8/);
	assert.match(await (await getPlaylist(requestAt(path + '&all=1'))).text(), /https:\/\/cdn\.shegu\.net\/a\/lower.m3u8/);
});
