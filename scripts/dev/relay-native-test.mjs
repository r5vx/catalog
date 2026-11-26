// Run after npm run build. Requires FFmpeg; never calls a provider or opens the real database.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'catalog-relay-'));
const cwd = process.cwd();
process.chdir(dir);
process.env.CATALOG_DB = ':memory:';
const host = 'https://fixture.vidrift.net';
let reply;
globalThis.fetch = async (url, options) => {
	assert.equal(new URL(url).origin, host, 'no network access');
	return reply(options);
};
const ffmpeg = args => execFileSync('ffmpeg', ['-v', 'error', '-nostdin', ...args], {windowsHide: true});
const rejectStatus = status => e => e.status === status;
try {
	const { GET } = await import('../../.svelte-kit/output/server/entries/endpoints/api/watch/relay/_server.ts.js');
	const relay = (path, range) => {
		const url = new URL('http://catalog.test/api/watch/relay');
		url.searchParams.set('u', host + path);
		return GET({ url, request: new Request(url, { headers: range ? {Range: range} : {} }) });
	};
	// Force the page signature and MP4 box to straddle separate chunks.
	const split = (bytes, headers, status = 200) => new Response(new ReadableStream({start(c) {
		c.enqueue(bytes.subarray(0, 3)); c.enqueue(bytes.subarray(3)); c.close();
	}}), {status, headers});
	for (const label of ['text/html', 'video/mp4', 'application/octet-stream']) {
		reply = () => split(Buffer.from('\ufeff  \n<!DOCTYPE HTML><html>Loading player</html>'), {'Content-Type': label});
		await assert.rejects(() => relay('/episode'), rejectStatus(502));
	}
	reply = () => new Response('Verification required', {headers: {'cf-mitigated': 'challenge'}});
	await assert.rejects(() => relay('/episode'), rejectStatus(403));
	reply = () => new Response('Blocked', {status: 403});
	await assert.rejects(() => relay('/episode'), rejectStatus(403));

	const clip = ['-f','lavfi','-i','color=c=black:s=96x64:r=12:d=1','-c:v','libx264','-threads','1'];
	const film = ffmpeg([...clip, '-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1']);
	reply = () => split(film, {'Content-Type':'text/html'});
	const mp4 = await relay('/film', 'bytes=0-');
	assert.equal(mp4.headers.get('Content-Type'), 'video/mp4');
	const bytes = Buffer.from(await mp4.arrayBuffer());
	assert.deepEqual(bytes, film);
	execFileSync('ffmpeg', ['-v','error','-xerror','-i','pipe:0','-f','null','-'], {input:bytes,windowsHide:true});
	const start = Math.floor(film.length / 2);
	reply = options => {
		assert.equal(new Headers(options.headers).get('Range'), `bytes=${start}-`);
		return split(film.subarray(start), {'Content-Type':'video/mp4','Content-Range':`bytes ${start}-${film.length - 1}/${film.length}`}, 206);
	};
	const seek = await relay('/film', `bytes=${start}-`);
	assert.equal(seek.status, 206);
	assert.deepEqual(Buffer.from(await seek.arrayBuffer()), film.subarray(start));

	const segment = ffmpeg([...clip,'-f','mpegts','pipe:1']);
	reply = () => split(Buffer.from('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\npart.ts\n#EXT-X-ENDLIST'), {'Content-Type':'text/html'});
	const playlist = await relay('/index.m3u8');
	assert.match(playlist.headers.get('Content-Type'), /mpegurl/);
	const line = (await playlist.text()).split('\n').find(l => l.startsWith('/api/watch/relay?'));
	assert.ok(line);
	const part = new URL(new URL(line, 'http://catalog.test').searchParams.get('u'));
	assert.equal(part.href, host + '/part.ts');
	reply = () => split(segment, {'Content-Type':'text/html'});
	assert.deepEqual(Buffer.from(await (await relay(part.pathname)).arrayBuffer()), segment);
	console.log('Relay passed: web-player HTML and challenges refused; MP4 decoded, range seek and HLS segment bytes preserved.');
} finally {
	process.chdir(cwd);
	rmSync(dir, {recursive:true, force:true});
}
