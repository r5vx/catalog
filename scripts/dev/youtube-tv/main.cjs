// Prototype: YouTube's TV interface in a Chromium window with a Fire TV user agent.
// PRUNE=1 strips ads. VIDEO = id to open. Off screen, muted. Writes shots + a log.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('mute-audio');
const PRUNE = process.env.PRUNE === '1';
const VIDEO = process.env.VIDEO || 'kJQP7kiw5Fk';
const OUT = path.join(__dirname, process.env.NAME || (PRUNE ? 'pruned' : 'plain'));
fs.mkdirSync(OUT, { recursive: true });
const UA = process.env.UA || 'Mozilla/5.0 (Linux armeabi-v7a; Android 9) Cobalt/23.lts.4.308335-gold (unlike Gecko) v8/8.8.278.17-jit gles Starboard/14, Amazon_ATV_mt8696_2019/PS7633.3445N (Amazon, AFTMM, Wireless) com.amazon.firetv.youtube/22.3.r2.v66.0';
setTimeout(() => app.exit(0), 170000);

app.whenReady().then(async () => {
	const win = new BrowserWindow({
		show: true, x: -4000, y: 0, width: 960, height: 540, useContentSize: true,
		webPreferences: { partition: 'yttv-' + (process.env.NAME || (PRUNE ? 'p' : 'n')), contextIsolation: false, sandbox: false, preload: path.join(__dirname, PRUNE ? 'preload.js' : 'preload-plain.js'), backgroundThrottling: false }
	});
	win.webContents.setUserAgent(UA);
	const log = [];
	const say = (s) => { log.push(s); fs.appendFileSync(path.join(OUT, 'live.txt'), s + String.fromCharCode(10)); };
	// raw player answers: did YouTube send ads?
	await win.loadURL('about:blank');
	const dbg = win.webContents.debugger;
	dbg.attach('1.3');
	await dbg.sendCommand('Network.enable').catch((e) => say('net enable err ' + e.message));
	const players = new Set();
	dbg.on('message', async (_e, method, p) => {
		if (method === 'Network.responseReceived' && /youtubei\/v1\/(player|next)|\/get_video_info|doubleclick|\/pagead\/|ad_break|\/ptracking/.test(p.response.url)) {
			if (/youtubei\/v1\/player/.test(p.response.url)) players.add(p.requestId);
			else say('net ' + p.response.status + ' ' + p.response.url.slice(0, 110));
		}
		if (method === 'Network.loadingFinished' && players.has(p.requestId)) {
			try {
				const b = await dbg.sendCommand('Network.getResponseBody', { requestId: p.requestId });
				const body = b.base64Encoded ? Buffer.from(b.body, 'base64').toString() : b.body;
				const j = JSON.parse(body);
				say(`player answer: video=${j.videoDetails?.videoId} adPlacements=${(j.adPlacements || []).length} playerAds=${(j.playerAds || []).length} adSlots=${(j.adSlots || []).length} sabr=${!!j.streamingData?.serverAbrStreamingUrl} formats=${(j.streamingData?.adaptiveFormats || []).length}`);
			} catch (e) { say('player body err ' + e.message); }
		}
	});
	win.webContents.on('console-message', (_e, _l, m) => { if (/catalog/i.test(m)) say('page: ' + m); });
	win.loadURL('https://www.youtube.com/tv').catch((e) => say('load err ' + e.message)); say('loading');
	await new Promise((r) => setTimeout(r, 12000));
	say('url after load: ' + win.webContents.getURL());
	fs.writeFileSync(path.join(OUT, 'home.png'), (await win.webContents.capturePage()).toPNG());
	const key = async (k) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k }); await new Promise((r) => setTimeout(r, 120)); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k }); await new Promise((r) => setTimeout(r, 1500)); };
	win.focus(); win.webContents.focus();
	await key('Return');
	const has = (t) => win.webContents.executeJavaScript(`document.body.innerText.includes(${JSON.stringify(t)})`);
	for (let i = 0; i < 20 && !(await has('Watch as guest')); i++) await new Promise((r) => setTimeout(r, 500));
	await new Promise((r) => setTimeout(r, 1500));
	const r = await win.webContents.executeJavaScript(`(() => { const el = [...document.querySelectorAll('*')].reverse().find((e) => e.childElementCount === 0 && e.textContent.trim() === 'Watch as guest'); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
	say('guest button at ' + JSON.stringify(r));
	if (r) { for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) { win.webContents.sendInputEvent({ type, x: r.x, y: r.y, button: 'left', clickCount: 1 }); await new Promise((q) => setTimeout(q, 150)); } }
	for (let i = 0; i < 20 && (await has('Watch as guest')); i++) await new Promise((r) => setTimeout(r, 500));
	say('after guest: ' + (await win.webContents.executeJavaScript('document.body.innerText.slice(0,200)')).replace(/\s+/g, ' '));
	await new Promise((r) => setTimeout(r, 6000));
	fs.writeFileSync(path.join(OUT, 'guest.png'), (await win.webContents.capturePage()).toPNG());
	await win.webContents.executeJavaScript(`location.hash = '#/watch?v=${VIDEO}'`);
	const pickGuest = async () => {
		const r = await win.webContents.executeJavaScript(`(() => { const el = [...document.querySelectorAll('*')].reverse().find((e) => e.childElementCount === 0 && e.textContent.trim() === 'Watch as guest'); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
		if (r) { for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) { win.webContents.sendInputEvent({ type, x: r.x, y: r.y, button: 'left', clickCount: 1 }); await new Promise((q) => setTimeout(q, 150)); } }
		return !!r;
	};
	for (let i = 0; i < 12; i++) { await new Promise((q) => setTimeout(q, 500)); if (await pickGuest()) { say('picked guest again'); break; } }
	for (let i = 1; i <= 6; i++) {
		await new Promise((r) => setTimeout(r, 8000));
		const st = await win.webContents.executeJavaScript(`(() => { const v = document.querySelector('video'); const ad = document.querySelector('[class*="ad-showing"],[class*="ytlr-ad"],[class*="ad-badge"],ytlr-ad-preview-renderer,ytlr-skip-ad-renderer'); return { t: v && v.currentTime.toFixed(1), d: v && v.duration && v.duration.toFixed(1), paused: v && v.paused, adUi: !!ad, adTag: ad && (ad.tagName + '.' + ad.className).slice(0,80), stats: window.__catalogAds ? { removed: __catalogAds.removed, seenAds: __catalogAds.seenAds, players: __catalogAds.players } : null }; })()`);
		say(`t+${i * 8}s ` + JSON.stringify(st));
		if (i === 2) say('diag ' + JSON.stringify(await win.webContents.executeJavaScript(`({ asked: (window.__catalogFormats||{}).asked, mimes: window.__catalogAds && __catalogAds.mimes, sabr: window.__catalogAds && __catalogAds.sabr, play: window.__catalogAds && __catalogAds.play, err: [...document.querySelectorAll('video')].map(v => v.error && (v.error.code + ' ' + v.error.message)), mms: typeof ManagedMediaSource, canH264: document.createElement('video').canPlayType('video/mp4; codecs="avc1.4d401f"') })`), null, 1));
		if (i === 2 || i === 6) fs.writeFileSync(path.join(OUT, `watch${i}.png`), (await win.webContents.capturePage()).toPNG());
	}
	fs.writeFileSync(path.join(OUT, 'log.txt'), log.join('\n'));
	app.exit(0);
});
