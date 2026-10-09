/**
 * Watches how a streaming site loads its video, so Catalog can learn to play it.
 *
 *   npm run probe -- https://anime.nexus
 *
 * Opens the site in a normal window. You browse it yourself — pass any "are you human" check,
 * open an episode, press play — and this writes down the requests that look like video,
 * subtitles or the site's player API (address, type, the Referer/Origin the page sent, and
 * what came back) to source-probe-<site>.txt in the project folder. Close the window when done.
 *
 * It also keeps a copy of what the site's own lookups answered (episode lists, stream details,
 * subtitle lists — never login or account calls), and once you close the site, it plays the
 * last video it saw in a plain test window — first with the site still open in the background,
 * then with it closed — to find out what Catalog needs to keep open to play it.
 *
 * Cookies and login headers are never written down. The window keeps its cookies in the
 * "sources" session, the one Catalog will use for these sites, so a check passed here counts
 * there too. Nothing here touches the library.
 */
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const start = process.argv.find((a) => /^https?:\/\//.test(a)) || 'https://anime.nexus';
// One log per site: source-probe-anime.nexus.txt, source-probe-aniwaves.ru.txt…
const logFile = path.join(__dirname, '..', `source-probe-${new URL(start).hostname}.txt`);
const lines = [];
const seen = new Set();
/** The last whole-video playlist the site played, and the subtitle files it fetched. */
let lastStream = null;
const subtitleUrls = [];
let replaying = false;

/** The site's own lookups worth keeping the answers of. Login and account calls are left out. */
const KEEP_BODY =
	/\/api\/anime\/(shows|details\/episodes|details\/episode\/stream|details\/related)|\/ajax\/(anime\/search|episode\/list|server\/list|sources)|getSources|mediainfo|requestType=master|\.m3u8(\?|$)|\.(vtt|srt)(\?|$)/i;
/** Video players embedded from other sites answer on their own addresses; keep their JSON too. */
const keepFromPlayer = (url, mimeType) =>
	/json/i.test(mimeType) && !url.includes(new URL(start).hostname) && !/thumbnails|cues/.test(url);
const NEVER_BODY = /auth|session|token|login|user|comments|verification|socket/i;

/** Video, playlists, subtitles, keys, and the JSON calls a player makes to find them. */
const INTERESTING =
	/\.(m3u8|mpd|mp4|m4s|ts|webm|mkv|vtt|srt|ass|key)(\?|$)|\/(playlist|master|manifest|source|sources|stream|episode|episodes|embed|player|video|subtitle|subtitles|servers?)\b|ajax|\/api\//i;
const BORING = /\.(png|jpe?g|webp|gif|svg|ico|css|woff2?|ttf)(\?|$)|google|doubleclick|analytics|sharethis|gtag|cloudflareinsights|cdn-cgi\/(rum|challenge-platform)/i;

function note(text) {
	const line = `[${new Date().toISOString().slice(11, 19)}] ${text}`;
	lines.push(line);
	console.log(line);
	fs.writeFileSync(logFile, lines.join('\n') + '\n', 'utf8');
}

app.whenReady().then(() => {
	const sources = session.fromPartition('persist:sources');
	// A plain Chrome identity, as Catalog's own windows use.
	const chrome = sources.getUserAgent().replace(/\s*Electron\/\S+/, '').replace(/\s*catalog\/\S+/i, '');
	sources.setUserAgent(chrome);

	sources.webRequest.onBeforeSendHeaders((details, callback) => {
		const { url, method, resourceType } = details;
		if (resourceType === 'mainFrame' || resourceType === 'subFrame') {
			note(`PAGE ${resourceType === 'subFrame' ? '(inside a frame) ' : ''}${url}`);
		} else if (!BORING.test(url) && (INTERESTING.test(url) || resourceType === 'media')) {
			const headers = details.requestHeaders;
			const ref = headers.Referer || headers.referer || '';
			const origin = headers.Origin || headers.origin || '';
			const key = `${method} ${url.split('?')[0]}`;
			if (/requestType=master/.test(url) || (/\.m3u8(\?|$)/.test(url) && !/requestType=|mkv_\d/.test(url))) {
				lastStream = { url, referer: ref, origin };
			}
			if (/\.(vtt|srt|ass)(\?|$)/i.test(url) && !/thumbnails|cues/.test(url) && !subtitleUrls.includes(url)) {
				subtitleUrls.push(url);
			}
			if (!seen.has(key)) {
				seen.add(key);
				note(`${method} ${resourceType} ${url}${ref ? `\n           Referer: ${ref}` : ''}${origin ? `\n           Origin: ${origin}` : ''}`);
			}
		}
		callback({ requestHeaders: details.requestHeaders });
	});

	sources.webRequest.onCompleted((details) => {
		const { url, statusCode, resourceType } = details;
		if (BORING.test(url) || !(INTERESTING.test(url) || resourceType === 'media')) return;
		const type = (details.responseHeaders?.['content-type'] || details.responseHeaders?.['Content-Type'] || [''])[0];
		if (/mpegurl|dash|video|vtt|subrip|json|text\/plain/i.test(type) || statusCode >= 400) {
			const key = `done ${url.split('?')[0]}`;
			if (seen.has(key)) return;
			seen.add(key);
			note(`   ↳ ${statusCode} ${type} ${url.length > 140 ? url.slice(0, 140) + '…' : url}`);
		}
	});

	const win = new BrowserWindow({
		width: 1280,
		height: 800,
		title: 'Catalog — source probe (browse normally, then close)',
		webPreferences: { partition: 'persist:sources', contextIsolation: true, nodeIntegration: false }
	});
	// Pop-up ads open new windows; keep them out.
	win.webContents.setWindowOpenHandler(({ url }) => {
		note(`(blocked a pop-up: ${url})`);
		return { action: 'deny' };
	});
	keepAnswers(win.webContents);
	replayOnClose(win);
	note(`Opened ${start}`);
	win.loadURL(start);
});

/**
 * Copies down what the site's lookups answered, through Chromium's own network log (the same
 * one the developer tools read, without opening them). Frames from other sites — the video
 * player inside the page — are followed too.
 */
function keepAnswers(contents) {
	const dbg = contents.debugger;
	try {
		dbg.attach('1.3');
	} catch (e) {
		note(`(couldn't follow answers: ${e.message})`);
		return;
	}
	const wanted = new Map();
	// The page itself has no session id; frames from other sites each get one.
	const send = (method, params, sessionId) =>
		(sessionId ? dbg.sendCommand(method, params, sessionId) : dbg.sendCommand(method, params)).catch(() => {});
	const follow = (sessionId) => {
		send('Network.enable', {}, sessionId);
		send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
	};
	dbg.on('message', (_event, method, params, sessionId) => {
		if (method === 'Target.attachedToTarget') {
			follow(params.sessionId);
		} else if (method === 'Network.responseReceived') {
			const url = params.response.url;
			const keep = (KEEP_BODY.test(url) && !/thumbnails|cues/.test(url)) || keepFromPlayer(url, params.response.mimeType);
			if (keep && !NEVER_BODY.test(url.split('?')[0])) {
				wanted.set(`${sessionId}|${params.requestId}`, url);
			}
		} else if (method === 'Network.loadingFinished') {
			const id = `${sessionId}|${params.requestId}`;
			const url = wanted.get(id);
			if (!url) return;
			wanted.delete(id);
			send('Network.getResponseBody', { requestId: params.requestId }, sessionId)
				.then((answer) => {
					if (!answer) return;
					const { body, base64Encoded } = answer;
					const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
					const short = text.length > 6000 ? text.slice(0, 6000) + `\n… (${text.length} characters in all)` : text;
					note(`ANSWER from ${url.length > 160 ? url.slice(0, 160) + '…' : url}\n${short}\n---`);
				});
		}
	});
	follow();
}

/**
 * Plays the last video the site played in a plain window, the way Catalog's own player would:
 * same Referer/Origin the site sent, nothing else from the site. Logs whether the playlist and
 * video pieces load, then jumps to the middle and checks again. Closes itself after `ms`.
 */
function replay(label, ms, then) {
	replaying = true;
	note(`\nREPLAY TEST — ${label}:\n  ${lastStream.url}`);
	const plain = session.fromPartition('probe-replay');
	plain.webRequest.onBeforeSendHeaders((details, callback) => {
		const headers = { ...details.requestHeaders };
		if (details.resourceType !== 'mainFrame') {
			if (lastStream.referer) headers.Referer = lastStream.referer;
			if (lastStream.origin) headers.Origin = lastStream.origin;
		}
		callback({ requestHeaders: headers });
	});
	plain.webRequest.onHeadersReceived((details, callback) => {
		const headers = { ...details.responseHeaders };
		headers['access-control-allow-origin'] = ['*'];
		callback({ responseHeaders: headers });
	});
	const page = `<!doctype html><meta charset="utf-8"><title>Replay test</title>
<body style="margin:0;background:#000;color:#ccc;font:14px sans-serif">
<video id="v" controls autoplay style="width:100%;height:90vh"></video><div id="s"></div>
<script src="${pathToFileURL(require.resolve('hls.js/dist/hls.min.js'))}"></script>
<script>
const say = (t) => { document.getElementById('s').textContent = t; console.log('REPLAY ' + t); };
const v = document.getElementById('v');
const hls = new Hls();
let pieces = 0;
hls.on(Hls.Events.MANIFEST_PARSED, (_, d) => say('playlist ok: ' + d.levels.length + ' qualities, ' + hls.audioTracks.length + ' audio tracks: ' + hls.audioTracks.map(a => a.name + '/' + a.lang).join(', ')));
hls.on(Hls.Events.FRAG_LOADED, () => { pieces++; if (pieces === 1 || pieces % 5 === 0) say(pieces + ' video pieces loaded, at ' + Math.round(v.currentTime) + 's'); });
hls.on(Hls.Events.ERROR, (_, d) => say('error: ' + d.type + ' ' + d.details + (d.response ? ' HTTP ' + d.response.code : '') + (d.fatal ? ' (fatal)' : '')));
hls.loadSource(${JSON.stringify(lastStream.url)});
hls.attachMedia(v);
setTimeout(() => { if (v.duration) { v.currentTime = v.duration / 2; say('jumped to the middle (' + Math.round(v.currentTime) + 's)'); } }, 15000);
for (const url of ${JSON.stringify(subtitleUrls)}) {
	fetch(url).then(r => r.text().then(t => say('subtitle ' + r.status + ' ' + url.split('/').pop() + ': ' + t.slice(0, 600).replace(/\\s+/g, ' ')))).catch(e => say('subtitle failed ' + url + ' ' + e));
}
</script>`;
	const file = path.join(app.getPath('temp'), 'catalog-probe-replay.html');
	fs.writeFileSync(file, page, 'utf8');
	const win = new BrowserWindow({
		width: 960,
		height: 600,
		title: `Replay test (${label}) — closes itself`,
		webPreferences: { partition: 'probe-replay', contextIsolation: true, nodeIntegration: false, webSecurity: false }
	});
	win.webContents.on('console-message', (event) => {
		const message = event.message;
		if (typeof message === 'string' && message.startsWith('REPLAY ')) note(message);
	});
	win.loadFile(file);
	setTimeout(() => {
		if (then) then();
		if (!win.isDestroyed()) win.close();
	}, ms);
}

/**
 * Closing the site runs two replays: first with the site still open but hidden (its own video
 * paused and muted), then with it really closed. If only the first plays, the site's page has
 * to stay open in the background for Catalog to play its videos.
 */
function replayOnClose(siteWin) {
	siteWin.on('close', (event) => {
		if (!lastStream || replaying) return;
		event.preventDefault();
		note('Site window hidden, still open in the background.');
		siteWin.webContents
			.executeJavaScript(`document.querySelectorAll('video').forEach((v) => { v.muted = true; v.pause(); })`)
			.catch(() => {});
		siteWin.hide();
		replay('site still open in the background', 35000, () => {
			// Opened before the site closes, so the app doesn't think every window is gone.
			replay('site closed', 35000);
			siteWin.destroy();
			note('Site window closed.');
		});
	});
}

app.on('window-all-closed', () => {
	note('Done.');
	console.log(`\nWritten to ${logFile}`);
	app.quit();
});
