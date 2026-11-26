/**
 * AllAnime's check, done by the person at this computer.
 *
 * AllAnime's GraphQL API returns NEED_CAPTCHA for episode-source queries. The
 * website handles this by showing a Turnstile widget, getting a token, and
 * retrying with { extensions: { captcha: { token, provider: "turnstile" } } }.
 *
 * This opens a small visible window on allmanga.to (the domain the sitekey is
 * registered for) showing only that widget. Catalog does not click it or look
 * inside it: the person ticks the box, and the token the widget hands back is
 * returned. Closing the window gives up.
 *
 * Every stage is written to %TEMP%\catalog-turnstile.log (never the token
 * itself), so a failed check says where it stopped.
 *
 * The window uses a persistent session so Cloudflare remembers past checks.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SITEKEY = '0x4AAAAAADAXQmN7FOUbtiV8';
const SITE = 'https://allmanga.to';

const logPath = path.join(os.tmpdir(), 'catalog-turnstile.log');
function log(msg) {
	try { fs.appendFileSync(logPath, new Date().toISOString() + ' [check] ' + msg + '\n'); } catch {}
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let activeCleanup = null;
function closeTurnstile() {
	if (activeCleanup) {
		log('window closed by Catalog (player navigated back)');
		try { activeCleanup(); } catch {}
		activeCleanup = null;
	}
}

async function solveTurnstile(targetUrl, timeoutMs = 120000, parentWin = null) {
	const failed = (error) => {
		log('done: no token (' + error + ')');
		return { token: '', provider: 'turnstile', solved: false, error };
	};

	let electron;
	try { electron = require('electron'); } catch { return failed('not in Electron'); }

	const { BrowserWindow, session: elSession } = electron;

	const partition = 'persist:turnstile';
	const ses = elSession.fromPartition(partition);
	// Keep Electron's native User-Agent untouched: rewriting only session.setUserAgent()
	// leaves SharedWorkers and ServiceWorkers on app.userAgentFallback, creating a UA
	// mismatch that causes Turnstile error 600010 even for a real human click.

	// When given a real AllManga / MKissa episode page URL, embed it inside Catalog's
	// main window (falling back to a separate window if Catalog isn't visible) so the
	// person can complete any Cloudflare check without a popup window.
	if (typeof targetUrl === 'string' && /^https:\/\/(?:allmanga\.to\/bangumi|mkissa\.to\/anime)\//i.test(targetUrl)) {
		return openEpisodePageForHuman(electron, ses, targetUrl, timeoutMs, failed, parentWin);
	}

	const started = Date.now();
	log('window opening, ' + Math.round(timeoutMs / 1000) + ' s allowed');

	const win = new BrowserWindow({
		width: 420, height: 300,
		show: true,
		center: true,
		alwaysOnTop: true,
		title: 'AllAnime: tick the box',
		autoHideMenuBar: true,
		resizable: false,
		minimizable: false,
		webPreferences: {
			session: ses,
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true
		}
	});
	win.setMenuBarVisibility(false);

	const wc = win.webContents;
	const cleanup = () => { activeCleanup = null; try { if (!win.isDestroyed()) win.destroy(); } catch {} };
	activeCleanup = cleanup;
	wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
		if (isMain) log('page failed to load: ' + code + ' ' + desc + ' ' + url);
	});

	try {
		await wc.loadURL(SITE + '/');
		await wait(500);
		log('page loaded: url=' + wc.getURL() + ' title=' + JSON.stringify(wc.getTitle()));

		await wc.executeJavaScript(`
			window.stop();
			document.head.innerHTML = '<title>AllAnime: tick the box</title>';
			document.body.innerHTML = '';
			document.body.style.cssText = 'margin:0;background:#1a1a2e;color:#ddd;font:15px system-ui,sans-serif;display:flex;flex-direction:column;gap:16px;justify-content:center;align-items:center;height:100vh;';

			window.__check = { token: null, error: null, turnedDown: 0, lastCode: '', stage: 'loading the check', interactive: false };

			var note = document.createElement('div');
			note.textContent = 'Tick the box to play this from AllAnime.';
			document.body.appendChild(note);

			var box = document.createElement('div');
			box.id = 'cf-box';
			document.body.appendChild(box);

			var s = document.createElement('script');
			s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
			s.onload = function() {
				window.__check.stage = 'check shown';
				turnstile.render('#cf-box', {
					sitekey: '${SITEKEY}',
					callback: function(t) { window.__check.token = t; window.__check.stage = 'token given'; },
					'error-callback': function(e) {
						// The widget asks again by itself, like on any site; the window stays open for it.
						window.__check.turnedDown++;
						window.__check.lastCode = String(e);
						window.__check.stage = 'turned down by Cloudflare (error ' + e + '), time ' + window.__check.turnedDown + '; the widget will ask again';
						note.textContent = 'Cloudflare turned that down (error ' + e + '). It will ask again in a few seconds.';
						return true;
					},
					'expired-callback': function() { window.__check.token = null; window.__check.stage = 'token expired'; },
					'timeout-callback': function() { window.__check.stage = 'check timed out, waiting for another tick'; },
					'unsupported-callback': function() { window.__check.error = 'unsupported browser'; window.__check.stage = 'error'; },
					'before-interactive-callback': function() { window.__check.interactive = true; window.__check.stage = 'waiting for the tick'; },
					'after-interactive-callback': function() { window.__check.stage = 'ticked, being verified'; },
					theme: 'dark',
					size: 'normal'
				});
			};
			s.onerror = function() { window.__check.error = 'api load failed'; window.__check.stage = 'error'; };
			document.head.appendChild(s);
		`);

		const deadline = Date.now() + timeoutMs;
		let lastStage = '';
		let turnedDown = 0;
		let lastCode = '';
		// Starts with "turned down" so allanime.ts can tell it from a box nobody ticked.
		const gaveUp = (how) => failed(turnedDown ? 'turned down by Cloudflare ' + turnedDown + ' time(s), last error ' + lastCode + '; ' + how : how);

		while (Date.now() < deadline) {
			await wait(500);
			if (win.isDestroyed()) return gaveUp('window closed by the person after ' + Math.round((Date.now() - started) / 1000) + ' s, at "' + lastStage + '"');

			let state;
			try {
				state = JSON.parse(await wc.executeJavaScript('JSON.stringify(window.__check || null)'));
			} catch { continue; }
			if (!state) continue;
			turnedDown = state.turnedDown || 0;
			lastCode = state.lastCode || '';

			if (state.stage !== lastStage) {
				lastStage = state.stage;
				log('stage: ' + state.stage);
			}

			if (state.token) {
				const secs = ((Date.now() - started) / 1000).toFixed(1);
				log('done: token given after ' + secs + ' s, ' + state.token.length + ' characters, ' + (state.interactive ? 'the box was shown and ticked' : 'no tick was asked for'));
				cleanup();
				return { token: state.token, provider: 'turnstile', solved: true, error: '' };
			}
			if (state.error) {
				cleanup();
				return failed('turnstile error ' + state.error);
			}
		}

		cleanup();
		return gaveUp('timeout at "' + lastStage + '"');
	} catch (e) {
		cleanup();
		return failed(e.message);
	}
}

async function openEpisodePageForHuman(electron, ses, episodeUrl, timeoutMs, failed, parentWin) {
	const { BrowserWindow, WebContentsView } = electron;
	const started = Date.now();
	const canEmbed = Boolean(
		WebContentsView &&
		parentWin &&
		!parentWin.isDestroyed() &&
		parentWin.isVisible() &&
		parentWin.contentView
	);
	log((canEmbed ? 'embedded popup opening: ' : 'episode check dialog opening: ') + episodeUrl + ' (' + Math.round(timeoutMs / 1000) + ' s allowed)');

	let headerView = null;
	let view = null;
	let win = null;
	let wc = null;
	let closed = false;
	let onResize = null;

	const webPreferences = {
		session: ses,
		nodeIntegration: false,
		contextIsolation: true,
		sandbox: true,
		backgroundThrottling: false
	};

	const HEADER_H = 38;
	const POP_W = 520;
	const POP_H = 520;
	let visible = false;

	const applyBounds = () => {
		if (!view || !headerView || !parentWin || parentWin.isDestroyed()) return;
		if (!visible) {
			headerView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
			// Keep a tiny on-screen 2x2 rect (with backgroundThrottling: false + muted audio) so Chromium
			// never freezes/throttles cross-origin player iframes like filelotion.fyi while hidden.
			view.setBounds({ x: 0, y: 0, width: 2, height: 2 });
			return;
		}
		const [cw, ch] = parentWin.getContentSize();
		const w = Math.min(POP_W, Math.max(360, cw - 32));
		const bodyH = Math.min(POP_H, Math.max(320, ch - HEADER_H - 64));
		const totalH = HEADER_H + bodyH;
		const x = Math.max(0, Math.round((cw - w) / 2));
		const y = Math.max(48, Math.round((ch - totalH) / 2));
		headerView.setBounds({ x, y, width: w, height: HEADER_H });
		view.setBounds({ x, y: y + HEADER_H, width: w, height: bodyH });
	};

	const setVisible = (next) => {
		if (visible === next) return;
		visible = next;
		if (canEmbed) {
			applyBounds();
		} else if (win && !win.isDestroyed()) {
			if (visible) win.show();
			else win.hide();
		}
	};

	if (canEmbed) {
		headerView = new WebContentsView({
			webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
		});
		view = new WebContentsView({ webPreferences });
		wc = view.webContents;
		wc.setAudioMuted(true);

		const headerHtml =
			'<!doctype html><html><head><meta charset="utf-8"><style>' +
			'*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif}' +
			'body{height:38px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;' +
			'background:#18181b;color:#f4f4f5;border:1px solid #3f3f46;border-bottom:1px solid #27272a;' +
			'border-radius:10px 10px 0 0;user-select:none}' +
			'span{font-size:13px;font-weight:600;letter-spacing:.01em}' +
			'a{display:grid;place-items:center;width:26px;height:26px;border-radius:6px;color:#a1a1aa;' +
			'text-decoration:none;font-size:16px;line-height:1}' +
			'a:hover{background:#27272a;color:#fff}' +
			'</style></head><body><span>AllAnime verification</span><a href="catalog-close://now" title="Close">✕</a></body></html>';

		headerView.webContents.on('will-navigate', (e, url) => {
			if (url.startsWith('catalog-close://')) {
				e.preventDefault();
				cleanup();
			}
		});
		headerView.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(headerHtml)).catch(() => {});

		parentWin.contentView.addChildView(headerView);
		parentWin.contentView.addChildView(view);
		// Start hidden; only show if Cloudflare actually presents a human challenge.
		applyBounds();
		onResize = applyBounds;
		parentWin.on('resize', onResize);
	} else {
		win = new BrowserWindow({
			width: POP_W,
			height: POP_H + HEADER_H,
			show: false,
			center: true,
			minimizable: false,
			maximizable: false,
			title: 'AllAnime verification',
			autoHideMenuBar: true,
			webPreferences
		});
		win.setMenuBarVisibility(false);
		wc = win.webContents;
	}

	let captured = '';
	let capturedEpisodeData = null;
	let cdpAttached = false;
	const cleanup = () => {
		if (closed) return;
		closed = true;
		activeCleanup = null;
		if (cdpAttached && wc && !wc.isDestroyed()) {
			try { wc.debugger.detach(); } catch {}
			cdpAttached = false;
		}
		try { ses.webRequest.onBeforeRequest(null); } catch {}
		try { ses.webRequest.onHeadersReceived(null); } catch {}
		if (onResize && parentWin && !parentWin.isDestroyed()) {
			try { parentWin.off('resize', onResize); } catch {}
			onResize = null;
		}
		if (headerView) {
			try { if (parentWin && !parentWin.isDestroyed()) parentWin.contentView.removeChildView(headerView); } catch {}
			try { if (!headerView.webContents.isDestroyed()) headerView.webContents.destroy(); } catch {}
			headerView = null;
		}
		if (view) {
			try { if (parentWin && !parentWin.isDestroyed()) parentWin.contentView.removeChildView(view); } catch {}
			try { if (!wc.isDestroyed()) wc.destroy(); } catch {}
			view = null;
		}
		if (win) {
			try { if (!win.isDestroyed()) win.destroy(); } catch {}
			win = null;
		}
	};
	activeCleanup = cleanup;

	const isMediaUrl = (u) => {
		if (!u || !/^https?:\/\//i.test(u)) return false;
		if (/challenges\.cloudflare\.com|google|doubleclick|analytics|adsystem|\.(png|jpg|jpeg|webp|gif|svg|css|js|woff2?|vtt|srt|ass|html?)(\?|$)/i.test(u)) return false;
		return /\.m3u8(\?|$|#)|master\.m3u8|playlist\.m3u8|\.mp4(\?|$)|tools\.fast4speed\.rsvp\/.+|wixmp\.com\/video|videoplayback/i.test(u);
	};

	const noteCapture = (u, how) => {
		if (captured || !u || !/^https?:\/\//i.test(u)) return;
		captured = u;
		log('captured stream (' + how + ') after ' + Math.round((Date.now() - started) / 1000) + ' s: ' + u.slice(0, 120));
	};

	// Listen across all frames in this session (skip mainFrame/subFrame HTML embeds).
	ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
		if (!captured && details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') {
			if (details.resourceType === 'media') noteCapture(details.url, 'media');
			else if (isMediaUrl(details.url)) noteCapture(details.url, 'url');
		}
		callback({});
	});

	let diagCount = 0;
	let passedAt = 0;
	// Also catch any real HLS or video response by Content-Type (even if the URL has no .m3u8/.mp4 extension,
	// e.g. tools.fast4speed.rsvp video responses — while ignoring HTML embed pages).
	ses.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
		if (!captured && details.statusCode >= 200 && details.statusCode < 400 && details.responseHeaders) {
			const hdr = (name) => {
				const k = Object.keys(details.responseHeaders).find((x) => x.toLowerCase() === name);
				return k ? String(details.responseHeaders[k][0] || '') : '';
			};
			const ct = hdr('content-type').toLowerCase();
			if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') {
				if (/mpegurl|video\/mp4|video\/webm|video\/quicktime/.test(ct)) {
					noteCapture(details.url, 'mime:' + ct.split(';')[0]);
				} else if (details.resourceType === 'media' && !/text\/html|application\/json|javascript/.test(ct)) {
					noteCapture(details.url, 'media-hdr:' + (ct.split(';')[0] || 'raw'));
				} else if (hdr('content-range') && /octet-stream|video\//.test(ct)) {
					noteCapture(details.url, 'range:' + ct.split(';')[0]);
				}
			}
			if (!captured && passedAt > 0 && diagCount < 30 && !/^(image|stylesheet|font|script)$/.test(details.resourceType) && !/cloudflare|google|mkissa\.to\/cdn-cgi|cdn-cgi\/rum/i.test(details.url)) {
				diagCount++;
				log('post-clear net: ' + details.statusCode + ' ' + details.resourceType + ' ' + ct.split(';')[0] + ' ' + details.url.slice(0, 120));
			}
		}
		callback({});
	});

	const isChallengeTitle = (t) => /just a moment|attention required|verify you are human/i.test(t || '');

	// Capture MKissa / AllAnime's signed GraphQL episode JSON directly via CDP Network.getResponseBody
	// so allanime.ts can decode sourceUrls and play the direct stream immediately without waiting on
	// any third-party embed player or modal popup.
	const cdpPending = new Map();
	wc.on('did-start-loading', () => {
		if (cdpAttached || closed || wc.isDestroyed()) return;
		try {
			wc.debugger.attach('1.3');
			cdpAttached = true;
			wc.debugger.sendCommand('Network.enable').catch(() => {});
			wc.debugger.on('message', async (_e, method, params) => {
				if (closed || capturedEpisodeData) return;
				if (method === 'Network.responseReceived') {
					const u = params?.response?.url || '';
					if (/api\.(mkissa\.net|allanime\.day)\/api/i.test(u) && /showId/i.test(u)) {
						cdpPending.set(params.requestId, u);
					}
				} else if (method === 'Network.loadingFinished' && cdpPending.has(params.requestId)) {
					cdpPending.delete(params.requestId);
					try {
						const res = await wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId });
						const text = res?.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : (res?.body || '');
						if (text && text.includes('sourceUrls')) {
							const parsed = JSON.parse(text);
							if (parsed?.data?.episode?.sourceUrls?.length) {
								capturedEpisodeData = parsed.data;
								log('captured episode sourceUrls (' + parsed.data.episode.sourceUrls.length + ' sources) after ' + Math.round((Date.now() - started) / 1000) + ' s');
							}
						}
					} catch {}
				}
			});
		} catch {}
	});

	wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
		if (isMain) log('episode page failed to load: ' + code + ' ' + desc + ' ' + url);
	});

	try {
		await wc.loadURL(episodeUrl);
		log('episode page loaded: url=' + wc.getURL() + ' title=' + JSON.stringify(wc.getTitle()));

		const deadline = Date.now() + timeoutMs;
		let lastTitle = wc.getTitle();
		if (isChallengeTitle(lastTitle)) setVisible(true);

		while (Date.now() < deadline) {
			if (capturedEpisodeData) {
				cleanup();
				return { token: '', provider: 'turnstile', solved: true, episodeData: capturedEpisodeData };
			}
			if (captured) {
				cleanup();
				return { token: '', provider: 'turnstile', solved: true, streamUrl: captured };
			}
			if (closed || wc.isDestroyed() || (win && win.isDestroyed())) {
				cleanup();
				return failed('closed after ' + Math.round((Date.now() - started) / 1000) + ' s');
			}
			const t = wc.getTitle();
			if (t !== lastTitle) {
				lastTitle = t;
				log('episode page title changed: ' + JSON.stringify(t) + ' url=' + wc.getURL());
			}
			if (isChallengeTitle(t)) {
				setVisible(true);
				wc.executeJavaScript('document.documentElement.style.overflow="hidden";document.body.style.overflow="hidden";', true).catch(() => {});
			} else if (t && !/^mkissa\.to\//i.test(t)) {
				// Cloudflare cleared (or was already verified): hide immediately so the user never sees MKissa's page!
				setVisible(false);
				if (!passedAt) passedAt = Date.now();
				// Dismiss MKissa's own "Videos here are embedded from third-party sites" modal (only after
				// Cloudflare has cleared) so MKissa's player actually starts loading the episode stream.
				try {
					await wc.executeJavaScript(
						`(() => {
							for (const btn of document.querySelectorAll('button')) {
								const txt = (btn.textContent || '').trim().toLowerCase();
								if (txt === "don't show again" || txt === 'close') { btn.click(); return txt; }
							}
							return '';
						})()`,
						true
					).catch(() => '');
				} catch {}
				// Check <video> across ALL frames (including embedded player iframes).
				try {
					const frames = wc.mainFrame?.framesInSubtree || [wc.mainFrame];
					for (const frame of frames) {
						if (!frame || frame.isDestroyed()) continue;
						const src = await frame.executeJavaScript(
							'(() => { const v = document.querySelector("video"); return (v && (v.currentSrc || v.src)) || ""; })()',
							true
						).catch(() => '');
						if (src && /^https?:\/\//i.test(src)) {
							noteCapture(src, 'video-el');
							cleanup();
							return { token: '', provider: 'turnstile', solved: true, streamUrl: captured };
						}
					}
				} catch {}
				if (Date.now() - passedAt > 20_000) {
					cleanup();
					return failed('no playable stream found after 20 s');
				}
			}
			await wait(300);
		}
		cleanup();
		return failed('timed out after ' + Math.round(timeoutMs / 1000) + ' s waiting for stream');
	} catch (err) {
		cleanup();
		return failed(err.message || String(err));
	}
}

module.exports = { solveTurnstile, closeTurnstile };
