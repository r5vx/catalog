// Opt-in Windows timing check: actual desktop backend, fresh profile, no access to the personal library.
// Run after npm run build. Starts at episode source selection, not at title resolution or UI navigation.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { youtubeCaptionOptions } from '../../src/lib/youtubeCaptionOptions.ts';
import { automaticEpisodeBudget, resolveCopies } from '../../src/lib/sourceFallback.ts';

assert.equal(process.platform, 'win32');
const root = fileURLToPath(new URL('../../', import.meta.url));
const port = await new Promise((resolve, reject) => {
	const server = createServer().on('error', reject).listen(0, '127.0.0.1', () => {
		const { port } = server.address(); server.close(() => resolve(port));
	});
});
const dir = mkdtempSync(join(tmpdir(), 'catalog-startup-test-'));
const env = { ...process.env, CATALOG_DB: join(dir, 'scratch.db'), APPDATA: dir, LOCALAPPDATA: dir, CATALOG_PORT: String(port) };
delete env.ELECTRON_RUN_AS_NODE;
const packed = process.argv.includes('--packed');
const exe = packed ? join(root, 'dist-app/win-unpacked/Catalog.exe') : createRequire(import.meta.url)('electron');
const app = spawn(exe, ['--user-data-dir=' + join(dir, 'profile'), ...(packed ? [] : [root])], { cwd: dir, env, stdio: 'ignore', windowsHide: true });
const base = `http://127.0.0.1:${port}`;
const pilot = 'aGhqumcE6_w', rizzo = '4iSCOtYs_6Q';
try {
	let ready = false;
	for (let i = 0; i < 100 && app.exitCode === null; i++) {
		try { ready = (await fetch(base + '/api/watch/stream', { signal: AbortSignal.timeout(500) })).status === 400; } catch {}
		if (ready) break;
		await delay(300);
	}
	assert.ok(ready, 'Test host did not start');
	const s2 = process.argv.includes('--s2e2');
	if (process.argv.includes('--resolve') || s2) {
		const started = performance.now();
		const r = await fetch(base + '/api/watch/resolve?title=Hot+Ones&type=tv&year=2015&resume_s=' + (s2 ? '2' : '1') + '&resume_e=2&nostream=1', { signal: AbortSignal.timeout(90_000) });
		assert.ok(r.ok, 'Series resolver failed');
		const episodes = (await r.json()).episodes?.episodes || [];
		for (const [number, id] of [[1, pilot], [2, rizzo], [3, 'H7pSH4YL-T4']]) {
			const ep = episodes.find(e => e.season === 1 && e.episode === number);
			assert.deepEqual(ep?.files.filter(f => f.shareKey?.startsWith('channel:')).map(f => f.shareKey), ['channel:' + id]);
		}
		const ep = episodes.find(e => e.season === 2 && e.episode === 2);
		assert.deepEqual(ep?.files.filter(f => f.shareKey?.startsWith('channel:')).map(f => f.shareKey), ['channel:u2r9Lo9-7rY']);
		const mapped = episodes.filter(e => e.files.some(f => f.source === 'YouTube · First We Feast'));
		console.log(JSON.stringify({ resolveMs: Math.round(performance.now() - started), regular: mapped.filter(e=>e.season>0).length, specials: mapped.filter(e=>e.season===0).length }));
		if (s2) await timeEpisode('u2r9Lo9-7rY', null, ep.files.filter(f => f.shareKey && f.source), ep.vidfastCandidate);
	}
	if (process.argv.includes('--captions')) {
		let previous;
		for (const id of [pilot, rizzo, 'H7pSH4YL-T4', 'u2r9Lo9-7rY']) {
			await timeEpisode(id, previous);
			const get = (vid, origin = base) => fetch(`${base}/api/youtube/hls/${vid}/captions.json`, {method:'POST', headers:{'Content-Type':'application/json','User-Agent':'Catalog Electron/test', origin}, signal:AbortSignal.timeout(22_000)});
			assert.equal((await get(id, 'https://example.org')).status, 403);
			if (previous) assert.equal((await get(previous)).status, 404);
			const r = await get(id); assert.equal(r.status, 200, 'No caption response for ' + id);
			const raw = await r.json();
			const en = youtubeCaptionOptions(id, raw).find(t => t.lang === 'en');
			assert.ok(en?.cues.length > 5, 'No usable English auto-generated captions on ' + id);
			assert.ok(en.cues.some(c => c.start < 90 && c.end > c.start));
			assert.deepEqual(youtubeCaptionOptions(previous || '', raw), []);
			console.log(JSON.stringify({id, caption:en.fileName, cues:en.cues.length}));
			previous = id;
		}
	} else if (process.argv.includes('--sample')) {
		for (const id of ['GaZeRSqWJg0','-L96m7LpNdo','E21hRISkLBA','jfCsew_mz7A','B1bZ-A5LKRw','tuenFu3OW0Q','sFy3rEG91OU']) {
			try { await timeEpisode(id); } catch (e) { console.error(id, e.message); process.exitCode=1; }
		}
	} else if (!s2 && !process.argv.includes('--episode=2')) await timeEpisode(pilot);
	if (process.argv.includes('--episode=2') || process.argv.includes('--switch')) await timeEpisode(rizzo, process.argv.includes('--switch') ? pilot : null);
} finally {
	await cleanup();
}

async function timeEpisode(id, previous, actualFiles, vidfastCandidate) {
	const copy = { source: 'YouTube', shareKey: 'channel:' + id };
	const movy = { source: 'Movy', shareKey: 'fixture:movy' };
	const seven = { source: '7Movies', shareKey: 'fixture:7movies' };
	const files = actualFiles ?? (id === rizzo ? [movy, seven, copy] : [copy]);
	const start = performance.now();
	let askedAt, requestEpoch;
	// Mirrors an episode where previous sources have missed and an unconfirmed candidate is still outstanding.
	const answer = await resolveCopies(files[0], files.slice(1), {
		current: () => true, key: f => f.shareKey, grace: 15_000, limit: 75_000, burnedWait: 0,
		...automaticEpisodeBudget(files, () => false),
		late: actualFiles ? (vidfastCandidate ? fetch(base + '/api/watch/prefetch', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({share_key:vidfastCandidate,fids:[-8],check:true}), signal:AbortSignal.timeout(12_000) }).then(r=>r.json()).then(r=>r.copy ?? null).catch(()=>null) : Promise.resolve(null)) : new Promise(() => {}),
		ask: async f => {
			if (!actualFiles && f !== copy) return new Promise(() => {});
			if (f.shareKey === copy.shareKey) { askedAt = performance.now(); requestEpoch = Date.now(); }
			const responseJob = fetch(base + '/api/watch/stream?share_key=' + encodeURIComponent(f.shareKey) + '&fid=' + (f.fid ?? -1000000), { signal: AbortSignal.timeout(60_000) });
			if (previous) {
				await delay(1500);
				const old = await fetch(`${base}/api/youtube/hls/${previous}/video.m3u8`);
				assert.ok(old.ok, 'Late playlist read was not exercised');
			}
			const response = await responseJob;
			assert.ok(response.ok); const link = await response.json();
			if (actualFiles) console.log(JSON.stringify({source:f.source,elapsedMs:Math.round(performance.now()-start),link:!!link.url,reason:link.url?undefined:String(link.debug||'no link').replace(/https?:\/\/\S+/g,'[address]').slice(0,120)}));
			return link;
		}
	});
	assert.equal(answer.url, `/api/youtube/hls/${id}/main.m3u8`, 'Exact episode stream unavailable');
	const manifestAt = performance.now();
	const decoded = spawnSync('ffmpeg', ['-v','error','-nostdin','-i',base + answer.url,'-map','0:v:0','-frames:v','1','-map','0:a:0','-frames:a','1','-f','null','-'], { timeout: 35_000, windowsHide: true, stdio: 'ignore' });
	assert.equal(decoded.status, 0, 'Picture and sound did not decode');
	const ms = n => Math.round(n);
	const decodedAt = performance.now();
	const db = new DatabaseSync(env.CATALOG_DB, { readOnly: true });
	let listingMs;
	try {
		const { saved_at } = db.prepare('SELECT saved_at FROM watch_order_cache WHERE key = ?').get('yt-listing-v1|' + id);
		listingMs = saved_at - requestEpoch;
	} finally { db.close(); }
	const ahead = spawnSync('ffmpeg', ['-v','error','-nostdin','-live_start_index','0','-i',base + answer.url,'-map','0:v:0','-map','0:a:0','-t','8','-progress','pipe:1','-f','null','-'], { timeout: 35_000, windowsHide: true, encoding: 'utf8' });
	assert.equal(ahead.status, 0, 'Playback did not continue past the startup buffer');
	assert.ok([...ahead.stdout.matchAll(/^out_time_us=(\d+)/gm)].some(m => Number(m[1]) >= 7_900_000), 'Did not decode the first eight seconds');
	console.log(JSON.stringify({ id, previous, decodedSeconds:8, beforeStreamRequestMs: ms(askedAt-start), publicListingMs: listingMs, listingToManifestMs: ms(manifestAt-askedAt)-listingMs, requestToManifestMs: ms(manifestAt-askedAt), selectionToManifestMs: ms(manifestAt-start), selectionToDecoderExitMs: ms(decodedAt-start) }));
}

async function cleanup() {
	if (app.pid && app.exitCode === null) {
		const exit = new Promise(resolve => app.once('close', resolve));
		spawnSync('taskkill', ['/pid',String(app.pid),'/t','/f'], { windowsHide: true, stdio: 'ignore' });
		await Promise.race([exit, delay(2000)]);
	}
	for (let attempt = 0; ; attempt++) {
		try { await rm(dir, { recursive: true, force: true }); break; }
		catch (e) { if (attempt >= 10 || !['EPERM','EBUSY','ENOTEMPTY'].includes(e.code)) throw e; await delay(500); }
	}
}
