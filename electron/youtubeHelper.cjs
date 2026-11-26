/*
 * YouTube for a Roku (a Roku has no web browser, so YouTube's own TV app can't run on it).
 *
 * The computer runs YouTube's own TV app in a hidden, muted window (the same one the computer's
 * YouTube window and the Fire TV show, with the same ad stripping) and plays the video there, at
 * 4x speed, while youtubeCapture.js copies every piece YouTube's player receives. The pieces are
 * kept in <library folder>/youtube/<video id>/ with index.json, and Catalog's server hands them to
 * the Roku as an HLS stream (src/lib/server/youtube.ts). Proven 2026-11-04 on the PC: Despacito
 * (4:41) whole at 1080p in about 55 s of playing; jumping ahead instead dropped YouTube to 240p.
 *
 * One video at a time (a new one takes over). The Roku jumping past what's kept moves the hidden
 * player there. Asked for by the server: { type: 'youtube-capture', id, dir, from }.
 */
const { BrowserWindow, app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { TrackReader } = require('./fmp4.cjs');
const { collectCaptions } = require('./youtubeCaptions.cjs');

// A 2023 Samsung TV (Tizen 8), as the Fire TV app: the 2021 one got "This device no longer fully supports YouTube".
const AGENT = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 8.0) AppleWebKit/537.36 (KHTML, like Gecko) 108.0.5359.1/8.0 TV Safari/537.36';
const RATE = 4;
/** Videos kept at most (the oldest go first). */
const KEEP = 8;

let win = null;
let job = null;
let ticker = null;
let selectedId = '';
const captionJobs = new Set();

async function keepCaptions(id, folder) {
	if (id !== selectedId || captionJobs.has(id)) return;
	const live = job?.id === id && win && !win.isDestroyed() ? win : null;
	const current = () => id === selectedId && (!live || win === live);
	let spare, welcomeTimer;
	captionJobs.add(id);
	try {
		if (!live) {
			// A fully kept video can play without a capture window. Never navigate another episode's player.
			if (!JSON.parse(fs.readFileSync(path.join(folder, 'index.json'), 'utf8')).done) return;
			spare = new BrowserWindow({ show:false, webPreferences:{partition:'persist:youtube', sandbox:true, contextIsolation:true, nodeIntegration:false, backgroundThrottling:false} });
			spare.webContents.setAudioMuted(true);
			spare.webContents.setUserAgent(AGENT);
			spare.webContents.setWindowOpenHandler(() => ({action:'deny'}));
			void spare.loadURL(`https://www.youtube.com/tv#/watch?v=${id}`).catch(() => {});
			welcomeTimer = setInterval(() => {
				if (current() && !spare.isDestroyed()) enterGuestVideo(spare, id, current).catch(() => {});
			}, 750);
		}
		const tracks = await collectCaptions(live || spare, id, current, spare ? 90_000 : 30_000);
		if (current()) {
			const file = path.join(folder, 'auto-captions.json');
			fs.writeFileSync(file + '.tmp', JSON.stringify({id, tracks, at:Date.now()}));
			fs.renameSync(file + '.tmp', file);
		}
	} finally {
		clearInterval(welcomeTimer);
		if (spare && !spare.isDestroyed()) spare.destroy();
		captionJobs.delete(id);
	}
}

function preloadFile() {
	const file = path.join(app.getPath('userData'), 'youtube-helper-preload.js');
	const ads = fs.readFileSync(path.join(__dirname, '..', 'android', 'assets', 'youtube-tv.js'), 'utf8');
	const capture = fs.readFileSync(path.join(__dirname, 'youtubeCapture.js'), 'utf8');
	fs.writeFileSync(file, ads + '\n;\n' + capture);
	return file;
}

async function ensureWindow() {
	if (win && !win.isDestroyed()) return win;
	const page = win = new BrowserWindow({
		show: false,
		width: 1920,
		height: 1080,
		useContentSize: true,
		webPreferences: {
			partition: 'persist:youtube',
			contextIsolation: false,
			sandbox: true,
			nodeIntegration: false,
			preload: preloadFile(),
			backgroundThrottling: false
		}
	});
	win.webContents.setAudioMuted(true);
	win.webContents.setUserAgent(AGENT);
	win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	win.on('closed', () => {
		if (win === page) win = null;
	});
	await page.loadURL('about:blank');
	const dbg = page.webContents.debugger;
	dbg.attach('1.3');
	await dbg.sendCommand('Runtime.enable');
	await dbg.sendCommand('Runtime.addBinding', { name: '__catalogCapture' });
	dbg.on('message', (_e, method, p) => {
		if (page !== win || method !== 'Runtime.bindingCalled' || p.name !== '__catalogCapture') return;
		try {
			received(JSON.parse(p.payload));
		} catch (e) {
			note(`capture: ${e.message}`);
		}
	});
	return page;
}

const js = (code) => (win && !win.isDestroyed() ? win.webContents.executeJavaScript(code).catch(() => null) : Promise.resolve(null));

function note(text) {
	if (job) job.log.push(`${((Date.now() - job.started) / 1000).toFixed(1)}s ${text}`);
}

/* ------------------------------------------------------------ what the player receives */

function received(m) {
	if (!job) return;
	if (m.k === 'track') {
		const kind = /^video/.test(m.mime) ? 'video' : 'audio';
		job.readers[m.id] = { kind, mime: m.mime, reader: new TrackReader() };
		if (!job.tracks[kind]) job.tracks[kind] = { mime: m.mime, inits: [], pieces: [], current: -1 };
		return;
	}
	const r = job.readers[m.id];
	if (!r) return;
	if (m.k === 'abort') {
		r.reader.reset();
		return;
	}
	const track = job.tracks[r.kind];
	for (const got of r.reader.push(Buffer.from(m.b64, 'base64'))) {
		if (got.init) {
			let at = track.inits.findIndex((i) => fs.readFileSync(path.join(job.folder, i.file)).equals(got.init));
			if (at < 0) {
				at = track.inits.length;
				const file = `${r.kind}-init${at}.mp4`;
				fs.writeFileSync(path.join(job.folder, file), got.init);
				track.inits.push({ file, height: got.height || 0 });
			}
			track.current = at;
		} else if (got.piece && track.current >= 0) {
			// Each moment kept once: the first copy stays (a playlist already given out never changes).
			const start = Math.round(got.start * 1000) / 1000;
			if (track.pieces.some((p) => Math.abs(p[0] - start) < 0.05)) continue;
			const file = `${r.kind}-${Math.round(start * 1000)}.m4s`;
			fs.writeFileSync(path.join(job.folder, file), got.piece);
			track.pieces.push([start, Math.round(got.duration * 1000) / 1000, file, track.current]);
		}
	}
	job.dirty = true;
}

function writeIndex() {
	if (!job) return;
	job.dirty = false;
	const index = {
		id: job.id,
		duration: job.duration,
		done: job.done,
		error: job.error,
		height: job.height,
		video: job.tracks.video ?? null,
		audio: job.tracks.audio ?? null,
		log: job.log.slice(-40)
	};
	fs.writeFileSync(path.join(job.folder, 'index.tmp'), JSON.stringify(index));
	fs.renameSync(path.join(job.folder, 'index.tmp'), path.join(job.folder, 'index.json'));
}

/* ------------------------------------------------------------ driving the hidden player */

async function clickText(page, current, re) {
	const r = await page.webContents.executeJavaScript(`(() => { const el = [...document.querySelectorAll('*')].reverse().find((e) => e.childElementCount === 0 && ${re}.test(e.textContent.trim())); if (!el) return null; const b = el.getBoundingClientRect(); if (!b.width) return null; return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
	if (!r) return false;
	for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
		if (!current() || page.isDestroyed()) return false;
		page.webContents.sendInputEvent({ type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
		await new Promise((q) => setTimeout(q, 120));
	}
	return true;
}

async function pressEnter(page, current) {
	if (!current() || page.isDestroyed()) return;
	page.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
	await new Promise((q) => setTimeout(q, 120));
	if (current() && !page.isDestroyed()) page.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
}

/** YouTube's first screens: "Get started", then "Who's watching" (Guest, until an account is added). */
async function enterGuestVideo(page, id, current) {
	if (!page || page.isDestroyed() || !current() || !page.webContents.getURL().startsWith('https://www.youtube.com/tv')) return false;
	const text = await page.webContents.executeJavaScript(`document.body ? document.body.innerText.slice(0, 400) : ''`);
	if (!current() || page.isDestroyed()) return false;
	if (/Get started/.test(text) && !/Watch as guest|Guest/.test(text)) {
		await pressEnter(page, current);
		return true;
	}
	if (/Watch as guest|Add account|Who.s watching/.test(text)) return clickText(page, current, '/^(Watch as guest|Guest)$/');
	if (/Home|Recommended/.test(text)) await page.webContents.executeJavaScript(`if (!location.hash.includes('watch?v=')) location.hash = ${JSON.stringify('#/watch?v=' + id)}`);
	return false;
}

async function open(id) {
	const page = await ensureWindow();
	if (page !== win || job?.id !== id) return;
	await page.loadURL(`https://www.youtube.com/tv#/watch?v=${id}`);
}

async function tick() {
	if (!job || job.done || job.error) return;
	const mine = job;
	if (job.dirty) writeIndex();
	if (!job.tracks.video || !job.tracks.audio) {
		if (await enterGuestVideo(win, mine.id, () => job === mine) && job === mine) note('past the welcome screen');
		if (job !== mine) return;
		if (Date.now() - job.started > 45_000) {
			job.error = 'YouTube didn\'t start this video.';
			note(job.error);
			writeIndex();
		}
		return;
	}
	const st = await js(`(() => { const v = document.querySelector('video'); if (!v || !v.duration) return null; v.muted = true; if (v.playbackRate !== ${RATE}) v.playbackRate = ${RATE}; if (v.paused) v.play().catch(() => {}); let end = v.currentTime; for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 1 && v.buffered.end(i) > end) end = v.buffered.end(i); return { t: v.currentTime, d: v.duration, end: end, h: v.videoHeight }; })()`);
	if (!st || job !== mine) return;
	job.duration = st.d;
	job.height = Math.max(job.height || 0, st.h || 0);
	// The Roku jumped past what's kept: the hidden player goes there.
	if (job.wanted != null) {
		const want = job.wanted;
		job.wanted = null;
		if (!covered(job, want)) {
			note(`moving to ${want.toFixed(0)} s`);
			await js(`document.querySelector('video').currentTime = ${want}`);
			return;
		}
	}
	const kept = keptUntil(job);
	if (kept >= st.d - 0.6) {
		job.done = true;
		await js(`(() => { const v = document.querySelector('video'); if (v) v.pause(); })()`);
		if (job !== mine) return;
		note(`all kept (${st.d.toFixed(0)} s, up to ${job.height}p)`);
		writeIndex();
		return;
	}
	// Played to the end with holes left (from a jump): back to the first hole.
	if (st.t >= st.d - 1 && kept < st.d - 0.6) {
		note(`back to ${kept.toFixed(0)} s for what's missing`);
		await js(`document.querySelector('video').currentTime = ${kept}`);
	}
}

/** How far from the start both tracks are kept without a gap. */
function keptUntil(j) {
	const until = (track) => {
		if (!track) return 0;
		const list = [...track.pieces].sort((a, b) => a[0] - b[0]);
		let end = 0;
		for (const [start, length] of list) {
			if (start > end + 0.3) break;
			end = Math.max(end, start + length);
		}
		return end;
	};
	return Math.min(until(j.tracks.video), until(j.tracks.audio));
}

function covered(j, at) {
	const has = (track) => track && track.pieces.some(([start, length]) => start <= at + 0.3 && start + length > at);
	return has(j.tracks.video) && has(j.tracks.audio);
}

/** Older videos go, keeping the newest KEEP. */
function tidy(dir, keep) {
	try {
		const all = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== keep);
		const dated = all.map((d) => ({ name: d.name, at: fs.statSync(path.join(dir, d.name)).mtimeMs })).sort((a, b) => b.at - a.at);
		for (const old of dated.slice(KEEP - 1)) fs.rmSync(path.join(dir, old.name), { recursive: true, force: true });
	} catch {}
}

/** The server's ask: start keeping `id` (or, for the one already going, make sure `from` is kept). */
async function capture(message) {
	const id = String(message.id ?? '');
	const dir = String(message.dir ?? '');
	const from = Number(message.from) || 0;
	if (!/^[\w-]{6,20}$/.test(id) || !dir) return;
	if (message.resumeOnly && job && job.id !== id) return;
	const folder = path.join(dir, id);
	if (message.captionsOnly) return keepCaptions(id, folder);
	if (!message.resumeOnly) selectedId = id;
	// Kept whole before: nothing to do.
	try {
		const kept = JSON.parse(fs.readFileSync(path.join(folder, 'index.json'), 'utf8'));
		if (kept.done && !(job && job.id === id && !job.done)) return;
	} catch {}
	if (job && job.id === id && !job.error) {
		if (from > 0) job.wanted = from;
		return;
	}
	fs.rmSync(folder, { recursive: true, force: true });
	fs.mkdirSync(folder, { recursive: true });
	tidy(dir, id);
	// Keep the previous document's late media events out of the next episode.
	if (win && !win.isDestroyed()) win.destroy();
	const mine = job = { id, folder, started: Date.now(), readers: {}, tracks: {}, done: false, error: null, duration: 0, height: 0, wanted: from > 0 ? from : null, dirty: true, log: [] };
	writeIndex();
	if (!ticker) ticker = setInterval(() => tick().catch(() => {}), 700);
	try {
		await open(id);
	} catch (e) {
		if (job !== mine) return;
		job.error = 'The YouTube window couldn\'t open.';
		note(e.message);
		writeIndex();
	}
}

module.exports = { captureYouTube: capture, TV_AGENT: AGENT };
