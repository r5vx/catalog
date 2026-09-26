/**
 * The desktop wrapper.
 *
 * Catalog is a web app, so the "app" is just a plain window pointed at it. This
 * file starts the server quietly in the background, waits for it to answer,
 * and shows the window — so from your side it opens like any other program.
 */
const { app, BrowserWindow, shell, Menu, session } = require('electron');
const { fork } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,PlatformHEVCEncoderSupport');

const PORT = Number(process.env.CATALOG_PORT || 4173);
const ORIGIN = `http://127.0.0.1:${PORT}`;

let server = null;
let window = null;

/**
 * Where the project lives, working back from the running exe:
 *   <project>/dist-app/win-unpacked/Catalog.exe
 * That's the folder holding the updater script and node_modules.
 */
function projectRoot() {
	return path.resolve(path.dirname(process.execPath), '..', '..');
}

/**
 * There are two kinds of Catalog and they update in completely different ways.
 *
 *   source  — built from the project folder on this PC. Updating means
 *             rebuilding, which is what "Update Catalog.bat" does.
 *   release — installed from an installer someone was given. There's no source
 *             code and no npm here, so it updates itself from GitHub Releases.
 *
 * The presence of the batch file two folders up is what tells them apart.
 */
const SOURCE_MODE = fs.existsSync(path.join(projectRoot(), 'Update Catalog.bat'));

function startServer() {
	const entry = path.join(__dirname, '..', 'build', 'index.js');

	server = fork(entry, [], {
		env: {
			...process.env,
			PORT: String(PORT),
			HOST: '0.0.0.0', // so your phone can reach it over Tailscale
			// Lets the Settings page offer the "check for updates" button, and
			// tells it where the project (and the updater script) lives.
			CATALOG_DESKTOP: '1',
			CATALOG_PROJECT: projectRoot(),
			CATALOG_UPDATE_MODE: SOURCE_MODE ? 'source' : 'release',
			// Packed alongside the app, so "what's new" works with no connection.
			CATALOG_NOTES: path.join(__dirname, '..', 'RELEASE_NOTES.md'),
			CATALOG_VERSION: app.getVersion(),
			// The server picks its own stable location for library.db, the same
			// one `npm run dev` uses — so there's only ever one library.
			ELECTRON_RUN_AS_NODE: '1'
		},
		execPath: process.execPath,
		stdio: ['ignore', 'pipe', 'pipe', 'ipc']
	});

	server.on('message', async (message) => {
		// The updater can't overwrite Catalog.exe while it's running, so the
		// Settings page asks us to step aside once it has launched the helper.
		if (message?.type === 'quit-for-update') {
			console.log('[app] updating — closing so the rebuild can run');
			app.quit();
		}

		if (message?.type === 'print-pdf') makePdf(message.id, message.path);

		if (message?.type === 'check-for-updates') checkForUpdates();

		if (message?.type === 'install-update') {
			// Silent, and start back up afterwards — the person clicked a button
			// in Settings, they don't need to click through an installer too.
			autoUpdater().quitAndInstall(true, true);
		}

		if (message?.type === 'get-video-url') {
			const fid = Number(message.fid);
			const shareKey = String(message.shareKey);
			const postBody = `fid=${fid}&share_key=${shareKey}`;
			let hidden = null;
			let capturedUrl = '';
			let playerHtml = '';
			let videoInfo = '';

			try {
				const { net } = require('electron');
				const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

				// Log session cookies for debugging (names show in stream info too)
				let cookieNames = '';
				try {
					const cks = await session.defaultSession.cookies.get({ url: 'https://www.febbox.com' });
					cookieNames = cks.map(c => c.name).join(',');
					console.log('[video-url] cookies:', cookieNames);
				} catch {}

// 1. Hit file_info first (browser does this before player)
				try {
					await net.fetch(`https://www.febbox.com/file/file_info?fid=${fid}`, {
						headers: {
							'User-Agent': chromeUA,
							'Referer': 'https://www.febbox.com/',
							'X-Requested-With': 'XMLHttpRequest'
						}
					});
				} catch {}

				// 2. Fetch player HTML — net.fetch uses Chromium TLS + session cookies,
				//    onBeforeSendHeaders spoofs UA/Client Hints to hide Electron
				try {
					const resp = await net.fetch('https://www.febbox.com/file/player', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/x-www-form-urlencoded',
							'User-Agent': chromeUA,
							'Referer': 'https://www.febbox.com/',
							'Origin': 'https://www.febbox.com',
							'X-Requested-With': 'XMLHttpRequest',
							'Accept': '*/*',
							'Accept-Language': 'en-US,en;q=0.9'
						},
						body: postBody
					});
					playerHtml = await resp.text();
				} catch (e) {
					console.log('[video-url] fetch:', e.message);
				}

				// 2. Parse HTML for HD stream URL
				if (playerHtml) {
					// Find ALL m3u8 URLs in the HTML
					const allM3u8 = [...playerHtml.matchAll(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi)]
						.map(m => m[1].replace(/&amp;/g, '&'));
					// Prefer m3u8 from a non-febbox CDN
					const cdnM3u8 = allM3u8.find(u => !u.includes('febbox.com'));

					if (cdnM3u8) {
						// The HTML URL has quality=3 (360p). Try without it.
						if (cdnM3u8.includes('quality=')) {
							try {
								const parsed = new URL(cdnM3u8);
								parsed.searchParams.delete('quality');
								const noQualUrl = parsed.toString();
								const probe = await net.fetch(noQualUrl, {
									headers: { 'Referer': 'https://www.febbox.com/', 'Origin': 'https://www.febbox.com' },
									signal: AbortSignal.timeout(5000)
								});
								if (probe.ok) {
									const body = await probe.text();
									if (body.includes('#EXT-X-STREAM-INF') &&
										(body.includes('1920') || body.includes('1280') || body.includes('3840'))) {
										capturedUrl = noQualUrl;
										videoInfo = 'hd-noqual:' + noQualUrl.substring(0, 120);
									} else {
										console.log('[video-url] no-qual still low:', body.substring(0, 300));
										capturedUrl = cdnM3u8;
										videoInfo = 'lowq:' + cdnM3u8.substring(0, 120);
									}
								} else {
									console.log('[video-url] no-qual status:', probe.status);
									capturedUrl = cdnM3u8;
									videoInfo = 'noqual-' + probe.status + ':' + cdnM3u8.substring(0, 100);
								}
							} catch (e) {
								console.log('[video-url] no-qual err:', e.message);
								capturedUrl = cdnM3u8;
								videoInfo = 'noqual-err:' + cdnM3u8.substring(0, 100);
							}
						} else {
							capturedUrl = cdnM3u8;
							videoInfo = 'cdn-m3u8:' + cdnM3u8.substring(0, 120);
						}
					}

					// Try JW Player file: config pointing to an API endpoint
					if (!capturedUrl) {
						const fileM = playerHtml.match(/["']?file["']?\s*:\s*["'](https?:\/\/[^"']+)["']/i);
						if (fileM) {
							const fileUrl = fileM[1].replace(/&amp;/g, '&');
							if (/\.m3u8/i.test(fileUrl) && !fileUrl.includes('febbox.com')) {
								capturedUrl = fileUrl;
								videoInfo = 'jw-file:' + fileUrl.substring(0, 120);
							} else if (!/\.(m3u8|mp4)/i.test(fileUrl)) {
								try {
									const r = await net.fetch(fileUrl, {
										headers: { 'Referer': 'https://www.febbox.com/' },
										redirect: 'manual'
									});
									const loc = r.headers.get('location');
									if (loc && loc.includes('.m3u8')) {
										capturedUrl = loc;
										videoInfo = 'api-redir';
									} else if (r.ok) {
										const t = await r.text();
										const m = t.match(/(https?:\/\/[^\s"'<>]*\.m3u8[^\s"'<>]*)/);
										if (m) { capturedUrl = m[1]; videoInfo = 'api-body'; }
									}
								} catch {}
							}
						}
					}

					// Extract inline script content for debugging
					const inlineScripts = [...playerHtml.matchAll(/<script(?:\s[^>]*)?>(?!\s*$)([\s\S]*?)<\/script>/gi)]
						.map(m => m[1].trim()).filter(s => s.length > 10);
					const scriptSummary = inlineScripts.map(s => s.substring(0, 80)).join(' ## ');
					console.log('[video-url] html:', playerHtml.length + 'ch',
						'm3u8=' + allM3u8.length,
						'inline-scripts=' + inlineScripts.length,
						scriptSummary.substring(0, 500));
				}

				// 3. Quality-restricted? Try fetching from a real page context
				//    (in-page fetch shares session cookies + Chromium TLS, and
				//     onBeforeSendHeaders hides the Electron identity)
				if (capturedUrl && capturedUrl.includes('quality=')) {
					console.log('[video-url] quality-restricted, trying page-context fetch...');
					let ctxWin = null;
					try {
						ctxWin = new BrowserWindow({
							show: false, width: 800, height: 600,
							webPreferences: { nodeIntegration: false, contextIsolation: true }
						});

						await new Promise(resolve => {
							ctxWin.webContents.on('dom-ready', resolve);
							ctxWin.loadURL(`https://www.febbox.com/share/${shareKey}`);
							setTimeout(resolve, 8000);
						});

						const ctxHtml = await ctxWin.webContents.executeJavaScript(
							`fetch('/file/player',{method:'POST',` +
							`headers:{'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'},` +
							`body:${JSON.stringify(postBody)},` +
							`credentials:'include'` +
							`}).then(r=>r.text()).catch(()=>'')`
						);

						if (ctxHtml && ctxHtml.length > 100) {
							const ctxUrls = [...ctxHtml.matchAll(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi)]
								.map(m => m[1].replace(/&amp;/g, '&'));
							const ctxCdn = ctxUrls.find(u => !u.includes('febbox.com'));
							if (ctxCdn && !ctxCdn.includes('quality=')) {
								capturedUrl = ctxCdn;
								videoInfo = 'ctx-hd:' + ctxCdn.substring(0, 120);
								console.log('[video-url] page-context gave HD!');
							} else if (ctxCdn) {
								console.log('[video-url] page-context also restricted:', ctxCdn.substring(0, 150));
								videoInfo += '|ctx-q';
							} else {
								console.log('[video-url] page-context no m3u8 found');
							}
						}
					} catch (e) {
						console.log('[video-url] ctx err:', e.message);
					} finally {
						if (ctxWin) try { ctxWin.close(); } catch {}
					}
				}

				// 4. Hidden window: load player page with network interception
				if (!capturedUrl) {
					hidden = new BrowserWindow({
						show: true,
						x: -9999, y: -9999,
						width: 1280,
						height: 720,
						webPreferences: {
							nodeIntegration: false,
							contextIsolation: true,
							autoplayPolicy: 'no-user-gesture-required'
						}
					});
					hidden.webContents.setAudioMuted(true);

					// Intercept requests to the HD CDN
					session.defaultSession.webRequest.onBeforeRequest(
						{ urls: ['*://*.shegu.net/*', '*://*/*.m3u8*'] },
						(details, callback) => {
							if (!capturedUrl && details.url.includes('.m3u8') &&
								!details.url.includes('febbox.com')) {
								capturedUrl = details.url;
								console.log('[video-url] net-capture:', details.url.substring(0, 200));
							}
							callback({});
						}
					);

					// Navigate directly — session cookies are already present
					hidden.loadURL('https://www.febbox.com/file/player', {
						postData: [{ type: 'rawData', bytes: Buffer.from(postBody) }],
						extraHeaders: 'Content-Type: application/x-www-form-urlencoded\nReferer: https://www.febbox.com/'
					});

					// Wait for page load + script execution time
					await new Promise(resolve => {
						const timer = setTimeout(resolve, 12000);
						hidden.webContents.on('did-finish-load', () => {
							clearTimeout(timer);
							setTimeout(resolve, 3000);
						});
					});

					// Poll JW Player (top frame + iframes)
					for (let i = 0; i < 12 && !capturedUrl; i++) {
						try {
							const url = await hidden.webContents.executeJavaScript(
								'(function(){' +
								'if(typeof jwplayer==="function"){try{var p=jwplayer().getPlaylistItem();if(p&&p.file)return p.file}catch(e){}}' +
								'try{var f=document.querySelectorAll("iframe");for(var j=0;j<f.length;j++){' +
								'try{var w=f[j].contentWindow;if(typeof w.jwplayer==="function"){var p2=w.jwplayer().getPlaylistItem();if(p2&&p2.file)return p2.file}}catch(e){}' +
								'}}catch(e){}' +
								'return""' +
								'})()'
							);
							if (url) { capturedUrl = url; videoInfo = 'jw:' + url.substring(0, 200); break; }
						} catch {}
						await new Promise(r => setTimeout(r, 500));
					}

					// Gather debug info if capture failed
					if (!capturedUrl) {
						try {
							videoInfo = await hidden.webContents.executeJavaScript(
								'(function(){var v=document.querySelector("video");var t=document.title||"";' +
								'var jw=typeof jwplayer;var ifs=document.querySelectorAll("iframe").length;' +
								'var sc=document.querySelectorAll("script[src]");' +
								'var srcs=[];for(var i=0;i<Math.min(sc.length,5);i++)srcs.push(sc[i].src.split("/").pop());' +
								'var loc=location.href.substring(0,100);' +
								'return(v?"vid:"+v.src.substring(0,100):"no-vid")+" t:"+t.substring(0,60)+' +
								'" jw:"+jw+" if:"+ifs+" sc:["+srcs.join(",")+"] url:"+loc;})()'
							);
						} catch (e) { videoInfo = 'err:' + (e.message || '').substring(0, 100); }
					}

					try { session.defaultSession.webRequest.onBeforeRequest(null); } catch {}
					hidden.close();
					hidden = null;
				}

				try {
					server.send({ type: 'get-video-url-result', id: message.id, playerHtml, dlText: '', capturedUrl, videoInfo: videoInfo + ' | ck:' + cookieNames });
				} catch {}
			} catch (e) {
				try { session.defaultSession.webRequest.onBeforeRequest(null); } catch {}
				if (hidden) try { hidden.close(); } catch {}
				try {
					server.send({
						type: 'get-video-url-result',
						id: message.id,
						playerHtml: '',
						dlText: '',
						capturedUrl: '',
						videoInfo: '',
						error: e?.message || String(e)
					});
				} catch {}
			}
		}

		if (message?.type === 'get-subtitles') {
			let hidden;
			try {
				hidden = new BrowserWindow({
					show: false,
					width: 400,
					height: 300,
					webPreferences: { nodeIntegration: false, contextIsolation: true }
				});

				const ready = new Promise((resolve) => {
					hidden.webContents.on('dom-ready', resolve);
					setTimeout(resolve, 10000);
				});
				hidden.loadURL('https://www.febbox.com');
				await ready;

				const fid = Number(message.fid);
				const shareKey = String(message.shareKey);

				const raw = await hidden.webContents.executeJavaScript(`
					(async function() {
						var endpoints = [
							{ url: '/file/subtitle_list', method: 'POST', body: 'fid=${fid}&share_key=${shareKey}' },
							{ url: '/file/subtitle/list', method: 'POST', body: 'fid=${fid}&share_key=${shareKey}' },
							{ url: '/file/subtitle?fid=${fid}&share_key=${shareKey}', method: 'GET' }
						];
						for (var i = 0; i < endpoints.length; i++) {
							try {
								var ep = endpoints[i];
								var opts = { method: ep.method, credentials: 'include' };
								if (ep.body) {
									opts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
									opts.body = ep.body;
								}
								var resp = await fetch(ep.url, opts);
								if (resp.ok) {
									var text = await resp.text();
									if (text && text.length > 2 && text[0] === '{') return text;
								}
							} catch(e) {}
						}
						return '';
					})()
				`);

				hidden.close();
				hidden = null;
				try {
					server.send({ type: 'get-subtitles-result', id: message.id, data: raw || '' });
				} catch {}
			} catch (e) {
				if (hidden) try { hidden.close(); } catch {}
				try {
					server.send({
						type: 'get-subtitles-result',
						id: message.id,
						data: '',
						error: e?.message || String(e)
					});
				} catch {}
			}
		}

		if (message?.type === 'debug-cookies') {
			try {
				const allCookies = await session.defaultSession.cookies.get({});
				const febCookies = allCookies
					.filter((c) => c.domain && c.domain.includes('febbox'))
					.map((c) => ({
						name: c.name,
						domain: c.domain,
						path: c.path,
						secure: c.secure,
						httpOnly: c.httpOnly,
						sameSite: c.sameSite,
						valueLen: c.value?.length ?? 0
					}));
				try {
					server.send({ type: 'debug-cookies-result', id: message.id, cookies: febCookies });
				} catch {}
			} catch (e) {
				try {
					server.send({ type: 'debug-cookies-result', id: message.id, cookies: [], error: e?.message || String(e) });
				} catch {}
			}
		}

		if (message?.type === 'sync-cookies') {
			try {
				const allCookies = await session.defaultSession.cookies.get({});
				const febCookies = allCookies.filter(
					(c) => c.domain && c.domain.includes('febbox')
				);
				const token = febCookies.length
					? febCookies.map((c) => `${c.name}=${c.value}`).join('; ')
					: '';
				try {
					server.send({ type: 'sync-cookies-result', id: message.id, token });
				} catch {}
			} catch (e) {
				try {
					server.send({
						type: 'sync-cookies-result',
						id: message.id,
						token: '',
						error: e?.message || String(e)
					});
				} catch {}
			}
		}

		if (message?.type === 'fetch-febbox') {
			try {
				const { net } = require('electron');
				const resp = await net.fetch(message.url, {
					method: message.options?.method ?? 'GET',
					headers: message.options?.headers,
					body: message.options?.body,
					credentials: 'include'
				});
				const body = await resp.text();
				try {
					server.send({
						type: 'fetch-febbox-result',
						id: message.id,
						status: resp.status,
						body
					});
				} catch {}
			} catch (e) {
				try {
					server.send({
						type: 'fetch-febbox-result',
						id: message.id,
						status: 0,
						body: '',
						error: e?.message || String(e)
					});
				} catch {}
			}
		}
	});

	server.stdout?.on('data', (chunk) => console.log('[server]', String(chunk).trim()));
	server.stderr?.on('data', (chunk) => console.error('[server]', String(chunk).trim()));
}

/**
 * Renders one of our own pages to a PDF.
 *
 * A hidden window, Chromium's own PDF engine, and the page's `@media print`
 * rules — the same thing the print dialog would have done, without depending
 * on a printer driver to produce a readable file.
 */
async function makePdf(id, path) {
	const reply = (extra) => {
		try {
			server?.send({ type: 'pdf-done', id, ...extra });
		} catch {
			// The server went away while we were rendering.
		}
	};

	let win = null;

	try {
		win = new BrowserWindow({
			show: false,
			webPreferences: { nodeIntegration: false, contextIsolation: true, javascript: true }
		});

		await win.loadURL(ORIGIN + path);

		const data = await win.webContents.printToPDF({
			pageSize: 'A4',
			printBackground: false,
			margins: { marginType: 'default' }
		});

		reply({ data: data.toString('base64') });
	} catch (error) {
		reply({ error: String(error?.message || error) });
	} finally {
		win?.destroy();
	}
}

/* ------------------------------------------------- updating an installed app */

let updater = null;

/**
 * Loaded only when it's needed. A build made from source has no release feed
 * to look at, and asking for one throws.
 */
function autoUpdater() {
	if (updater) return updater;

	updater = require('electron-updater').autoUpdater;
	updater.autoDownload = true;
	updater.autoInstallOnAppQuit = true;
	updater.logger = null;

	// The Settings page is a web page, so progress has to travel to the server
	// first. It holds the last state and hands it to the page when asked.
	const send = (state) => {
		try {
			server?.send({ type: 'update-state', state });
		} catch {
			// The server is already gone — nothing left to tell.
		}
	};

	updater.on('checking-for-update', () => send({ status: 'checking' }));
	updater.on('update-not-available', () => send({ status: 'none', version: app.getVersion() }));
	// autoDownload means "available" is immediately followed by the download.
	updater.on('update-available', (info) =>
		send({ status: 'downloading', version: info?.version, percent: 0 })
	);
	updater.on('download-progress', (progress) =>
		send({ status: 'downloading', percent: Math.round(progress?.percent ?? 0) })
	);
	updater.on('update-downloaded', (info) => send({ status: 'ready', version: info?.version }));
	updater.on('error', (error) =>
		send({ status: 'error', message: String(error?.message || error) })
	);

	return updater;
}

function checkForUpdates() {
	if (SOURCE_MODE || !app.isPackaged) return;

	autoUpdater()
		.checkForUpdates()
		.catch((error) => console.error('[update]', error?.message || error));
}

/** Poll until the server answers, so we never show a blank window. */
function waitForServer(timeoutMs = 20000) {
	const deadline = Date.now() + timeoutMs;

	return new Promise((resolve, reject) => {
		const attempt = () => {
			const request = http.get(`${ORIGIN}/`, (response) => {
				response.resume();
				resolve();
			});

			request.on('error', () => {
				if (Date.now() > deadline) reject(new Error('Server did not start in time.'));
				else setTimeout(attempt, 250);
			});
		};

		attempt();
	});
}

function createWindow() {
	window = new BrowserWindow({
		width: 1180,
		height: 820,
		minWidth: 420,
		minHeight: 500,
		show: false,
		backgroundColor: '#111614',
		autoHideMenuBar: true,
		// A multi-size .ico so Windows picks the right one instead of
		// squashing a 512px image down to taskbar size.
		icon: path.join(__dirname, '..', 'build', 'client', 'icon.ico'),
		webPreferences: { nodeIntegration: false, contextIsolation: true, webviewTag: true }
	});

	window.once('ready-to-show', () => window.show());
	window.loadURL(ORIGIN);

	// Febbox login needs its own window — Google OAuth blocks iframes.
	// The child window shares the default session, so cookies carry over.
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (url.includes('febbox.com')) {
			return {
				action: 'allow',
				overrideBrowserWindowOptions: {
					width: 500,
					height: 700,
					autoHideMenuBar: true,
					icon: path.join(__dirname, '..', 'build', 'client', 'icon.ico')
				}
			};
		}
		if (!url.startsWith(ORIGIN)) shell.openExternal(url);
		return { action: 'deny' };
	});

	window.webContents.on('did-create-window', async (childWindow) => {
		// Use a regular Chrome User-Agent — Electron's default UA contains
		// "Electron/38" which some sites (including Google OAuth) reject.
		const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
		childWindow.webContents.setUserAgent(chromeUA);

		// Clear stale febbox cookies so the OAuth flow starts clean.
		try {
			const stale = await session.defaultSession.cookies.get({});
			for (const c of stale) {
				if (c.domain && c.domain.includes('febbox')) {
					const scheme = c.secure ? 'https' : 'http';
					const dom = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
					await session.defaultSession.cookies.remove(`${scheme}://${dom}${c.path}`, c.name).catch(() => {});
				}
			}
			console.log('[login] cleared stale febbox cookies');
		} catch {}

		// Diagnostic logging — every navigation and cookie change is
		// recorded so we can see exactly where the OAuth flow breaks.
		const navLog = [];
		const cookieChanges = [];

		childWindow.webContents.on('did-navigate', (_e, url, httpCode) => {
			navLog.push({ url: url.substring(0, 120), status: httpCode });
			console.log(`[login] nav ${httpCode}: ${url.substring(0, 120)}`);
		});

		childWindow.webContents.on('did-redirect-navigation', (_e, url, _isInPlace, _isMainFrame, _frameProcessId, _frameRoutingId, isMainFrame) => {
			if (!isMainFrame) return;
			navLog.push({ url: url.substring(0, 120), status: 'redirect' });
			console.log(`[login] redirect → ${url.substring(0, 120)}`);
		});

		const cookieListener = (_e, cookie, cause, removed) => {
			if (cookie.domain && cookie.domain.includes('febbox')) {
				cookieChanges.push({ name: cookie.name, domain: cookie.domain, cause, removed });
				console.log(`[login] cookie ${removed ? 'DEL' : 'SET'}: ${cookie.name} @ ${cookie.domain} (${cause})`);
			}
		};
		session.defaultSession.cookies.on('changed', cookieListener);

		async function captureCookies() {
			try {
				const allCookies = await session.defaultSession.cookies.get({});
				const cookies = allCookies.filter(
					(c) => c.domain && c.domain.includes('febbox')
				);
				if (!cookies.length) return;

				const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
				const body = JSON.stringify({ token: cookieStr });

				const req = http.request(`${ORIGIN}/api/watch/save-token`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
				});
				req.on('error', () => {});
				req.write(body);
				req.end();
			} catch (e) {
				console.error('[app] cookie capture failed:', e?.message || e);
			}
		}

		// Show diagnostic overlay in the login window if session check fails
		async function showDiagnostics() {
			try {
				const allCookies = await session.defaultSession.cookies.get({});
				const febCookies = allCookies
					.filter((c) => c.domain && c.domain.includes('febbox'))
					.map((c) => ({ name: c.name, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite }));

				const diag = {
					navigations: navLog,
					cookieChanges,
					currentCookies: febCookies,
					userAgent: chromeUA
				};
				await childWindow.webContents.executeJavaScript(`
					(function() {
						var d = document.createElement('div');
						d.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.9);color:#0f0;font:12px monospace;padding:20px;z-index:99999;overflow:auto;white-space:pre-wrap';
						d.textContent = 'LOGIN DIAGNOSTICS\\n' + '='.repeat(50) + '\\n' + ${JSON.stringify(JSON.stringify(diag, null, 2))};
						document.body.appendChild(d);
					})()
				`);
			} catch {}
		}

		// Poll for valid session — auto-close on success, show diagnostics
		// after several failures so we can see what went wrong.
		let captured = false;
		let pollCount = 0;
		const loginPoll = setInterval(async () => {
			if (captured || childWindow.isDestroyed()) {
				clearInterval(loginPoll);
				return;
			}
			try {
				const url = await childWindow.webContents.executeJavaScript('window.location.href');
				if (!url.includes('febbox.com')) return;

				pollCount++;
				const result = await childWindow.webContents.executeJavaScript(`
					fetch('/console/user_info', { credentials: 'include' })
						.then(function(r) { return r.text(); })
						.then(function(t) {
							try { var d = JSON.parse(t); return d.code === 1 ? 'ok' : 'no:' + d.code; }
							catch(e) { return 'html'; }
						})
						.catch(function(e) { return 'err:' + e.message; })
				`);
				console.log(`[login] poll #${pollCount}: ${result}`);
				if (result === 'ok') {
					captured = true;
					clearInterval(loginPoll);
					console.log('[login] session confirmed — capturing cookies');
					await captureCookies();
					childWindow.close();
				} else if (pollCount >= 5 && !url.includes('/login') && !url.includes('accounts.google')) {
					clearInterval(loginPoll);
					console.log('[login] session NOT valid after OAuth — showing diagnostics');
					await showDiagnostics();
				}
			} catch {
				// Window navigating or destroyed
			}
		}, 2000);

		setTimeout(() => {
			clearInterval(loginPoll);
			session.defaultSession.cookies.removeListener('changed', cookieListener);
		}, 300000);

		childWindow.on('closed', () => {
			clearInterval(loginPoll);
			session.defaultSession.cookies.removeListener('changed', cookieListener);
			if (!captured) captureCookies();
		});
	});
}

// One window only — launching again focuses the one already open.
if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', () => {
		if (!window) return;
		if (window.isMinimized()) window.restore();
		window.focus();
	});

	app.whenReady().then(async () => {
		Menu.setApplicationMenu(null);

		// Strip framing restrictions so febbox loads inside webviews,
		// and inject CORS headers on external CDN responses so HLS.js
		// can fetch playlists and segments from any streaming domain.
		session.defaultSession.webRequest.onHeadersReceived(
			{ urls: ['http://*/*', 'https://*/*'] },
			(details, callback) => {
				const url = details.url;

				// Never touch our own server
				if (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:')) {
					callback({});
					return;
				}

				// Febbox: strip frame restrictions on subframes only
				if (url.includes('febbox.com')) {
					if (details.resourceType !== 'subFrame') {
						callback({});
						return;
					}
					const headers = { ...details.responseHeaders };
					delete headers['x-frame-options'];
					delete headers['X-Frame-Options'];
					delete headers['content-security-policy'];
					delete headers['Content-Security-Policy'];
					callback({ responseHeaders: headers });
					return;
				}

				// External CDN (shegu.net, etc.): add CORS for media/XHR
				if (details.resourceType === 'media' ||
					details.resourceType === 'xmlhttprequest' ||
					details.resourceType === 'other') {
					const headers = { ...details.responseHeaders };
					headers['access-control-allow-origin'] = ['*'];
					headers['access-control-allow-headers'] = ['*'];
					headers['access-control-allow-methods'] = ['GET, HEAD, OPTIONS'];
					callback({ responseHeaders: headers });
					return;
				}

				callback({});
			}
		);

		// Spoof Referer/Origin for febbox webview requests and for ALL
		// external media/XHR so HLS.js streams load at full quality
		// regardless of which CDN domain febbox routes them through.
		session.defaultSession.webRequest.onBeforeSendHeaders(
			{ urls: ['http://*/*', 'https://*/*'] },
			(details, callback) => {
				const url = details.url;

				// Never touch requests to our own server
				if (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:')) {
					callback({});
					return;
				}

				// Never touch top-level navigation (login window, etc.)
				if (details.resourceType === 'mainFrame') {
					callback({});
					return;
				}

				const headers = { ...details.requestHeaders };

				if (url.includes('febbox.com')) {
					const ref = headers['Referer'] || headers['referer'] || '';
					if (ref && !ref.includes('febbox.com') && !ref.includes('google.com')) {
						headers['Referer'] = 'https://www.febbox.com/';
						headers['Origin'] = 'https://www.febbox.com';
					}
				} else if (
					details.resourceType === 'media' ||
					details.resourceType === 'xmlhttprequest' ||
					details.resourceType === 'other'
				) {
					// Any external CDN: spoof for media/XHR/other so streams work
					headers['Referer'] = 'https://www.febbox.com/';
					headers['Origin'] = 'https://www.febbox.com';
				}

				callback({ requestHeaders: headers });
			}
		);

		/**
		 * A finished update gets installed before anything else happens.
		 *
		 * Waiting for the app to close is fragile — it can be reopened, or never
		 * closed at all, and a built update then sits unused for days. Catching
		 * it here means the worst case is one extra restart: the window never
		 * opens, the helper swaps, and Catalog comes back on the new version.
		 */
		const pending = pendingUpdate();

		if (pending) {
			/**
			 * A helper already waiting is not a reason to start another.
			 *
			 * This is what broke the 1.6.0 update. The helper sat waiting for
			 * Catalog to close; every launch spawned a rival that exited on the
			 * lock within milliseconds, `startHelper` reported success because
			 * spawning hadn't thrown, and the app quit anyway — burning an
			 * attempt each time. Three launches in ten seconds spent the whole
			 * budget without a single real swap, and the update declared itself
			 * uninstallable while a perfectly good helper was still waiting.
			 *
			 * If someone is genuinely on the job, the useful thing to do is get
			 * out of their way.
			 */
			if (helperWorking()) {
				console.log('[app] an update is being installed — stepping aside');
				showInstalling(pending.version);
				return;
			}

			if (startHelper(pending.staged)) {
				noteAttempt(pending);
				console.log(`[app] installing ${pending.version || 'an update'} before starting`);
				showInstalling(pending.version);
				return;
			}
		}

		startServer();

		try {
			await waitForServer();
		} catch (error) {
			console.error(error);
		}

		createWindow();

		// Quietly, in the background — a new version downloads itself and is
		// installed when the app next closes. Nothing interrupts you.
		checkForUpdates();

		app.on('activate', () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow();
		});
	});

	app.on('window-all-closed', () => app.quit());

	/**
	 * Stopping the server, properly.
	 *
	 * It's forked with Electron's own binary, so Windows lists it as a second
	 * "Catalog.exe". If it outlives the window, anything waiting for Catalog to
	 * close waits forever — which is exactly how the updater used to hang.
	 *
	 * So: ask it to stop as soon as we start quitting, and insist shortly
	 * after if it hasn't. SQLite is in WAL mode and survives the process
	 * ending; what it would not survive is being killed mid-write, hence the
	 * grace period rather than an immediate kill.
	 */
	let stopping = false;

	function stopServer() {
		if (!server || stopping) return;
		stopping = true;

		const child = server;
		child.kill();

		const insist = setTimeout(() => {
			if (!child.killed || child.exitCode === null) child.kill('SIGKILL');
		}, 2000);

		// Don't hold the app open just for this timer.
		insist.unref?.();
		child.once('exit', () => clearTimeout(insist));
	}

	/**
	 * Whether a helper is currently doing the work.
	 *
	 * `applying.txt` is rewritten every second while one waits, so a recent
	 * timestamp means somebody is on the job and a stale one means they died
	 * holding it. Telling those two apart is the whole point: one says step
	 * aside, the other says take over.
	 */
	const LOCK_STALE_MS = 30_000;

	function helperWorking() {
		try {
			const beat = Number(
				fs.readFileSync(path.join(projectRoot(), 'dist-staged', 'applying.txt'), 'utf8')
			);
			return Number.isFinite(beat) && Date.now() - beat < LOCK_STALE_MS;
		} catch {
			return false;
		}
	}

	/** Records that we have just handed the job to a helper of our own. */
	function noteAttempt(pending) {
		try {
			fs.writeFileSync(
				pending.marker,
				`${pending.staged}\n${pending.version}\n${pending.attempts + 1}\n${pending.firstSeen}`,
				'utf8'
			);
		} catch {
			// Then it gets one more go than intended. Not worth failing over.
		}
	}

	/**
	 * How many times we'll hand the job to a fresh helper, and how long the
	 * whole business gets before it's called off. Two limits because they catch
	 * different failures: one for a swap that keeps going wrong, one for a
	 * helper that hangs about achieving nothing.
	 */
	const MAX_ATTEMPTS = 3;
	const GIVE_UP_AFTER_MS = 30 * 60_000;

	/**
	 * An update that has been built but not yet installed.
	 *
	 * Returns the folder and the version in it, or null. The version is what
	 * stops a failed swap becoming a boot loop: if it matches what's already
	 * running, the marker is stale and gets cleared.
	 */
	function pendingUpdate() {
		if (!SOURCE_MODE) return null;

		const marker = path.join(projectRoot(), 'dist-staged', 'pending.txt');
		if (!fs.existsSync(marker)) return null;

		try {
			const [staged, version, tries, since] = fs.readFileSync(marker, 'utf8').trim().split('\n');
			if (!staged) return null;

			const exe = path.join(projectRoot(), staged, 'win-unpacked', 'Catalog.exe');
			if (!fs.existsSync(exe)) {
				fs.rmSync(marker, { force: true });
				return null;
			}

			// Already running it. Nothing to do, and the marker can go.
			if (version && version.trim() === app.getVersion()) {
				fs.rmSync(marker, { force: true });
				return null;
			}

			/**
			 * Give up rather than loop.
			 *
			 * Restarting into an update that cannot be installed would mean the
			 * window never opens at all, and an app you can't use is far worse
			 * than an update you haven't got. Only attempts we actually made
			 * count — a launch that stepped aside for a working helper did not
			 * try anything and must not be charged for one.
			 */
			const attempts = Number(tries ?? 0) || 0;
			const firstSeen = Number(since ?? 0) || Date.now();
			const tooLong = Date.now() - firstSeen > GIVE_UP_AFTER_MS;

			if (attempts >= MAX_ATTEMPTS || tooLong) {
				try {
					fs.writeFileSync(
						path.join(projectRoot(), 'dist-app', 'last-update.txt'),
						`Version ${version || 'the update'} was built but could not be installed. ` +
							'Close Catalog completely, then open it again.',
						'utf8'
					);
				} catch {
					// The marker still goes, which is the part that matters.
				}

				fs.rmSync(marker, { force: true });
				return null;
			}

			return { staged, version: (version ?? '').trim(), attempts, firstSeen, marker };
		} catch {
			return null;
		}
	}

	/**
	 * Say what is happening, then get out of the way.
	 *
	 * The old version of this quit in silence, so installing an update looked
	 * exactly like Catalog refusing to open — which is why it got clicked again
	 * and again, each click landing in the middle of the swap. A window that
	 * explains itself for a couple of seconds is the difference between waiting
	 * and fighting it.
	 */
	function showInstalling(version) {
		const message = version ? `Installing Catalog ${version}` : 'Installing an update';

		const html = `<!doctype html><meta charset="utf-8">
			<style>
				html, body { margin: 0; height: 100%; }
				body {
					background: #111614; color: #e7ece9;
					font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
					display: grid; place-items: center; text-align: center;
					-webkit-user-select: none; user-select: none;
				}
				strong { display: block; font-size: 1.05rem; margin-bottom: 6px; }
				span { color: #8fa39a; font-size: 0.88rem; }
			</style>
			<div>
				<strong>${message}…</strong>
				<span>It reopens by itself in a moment. No need to click anything.</span>
			</div>`;

		try {
			const note = new BrowserWindow({
				width: 420,
				height: 190,
				resizable: false,
				minimizable: false,
				maximizable: false,
				frame: false,
				show: false,
				backgroundColor: '#111614',
				webPreferences: { nodeIntegration: false, contextIsolation: true }
			});

			note.once('ready-to-show', () => note.show());
			note.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
		} catch {
			// No window, then. The update still happens.
		}

		// Long enough to read, short enough that the helper isn't kept waiting.
		setTimeout(() => app.quit(), 2500);
	}

	function startHelper(staged) {
		try {
			const helper = require('node:child_process').spawn(
				'node',
				[path.join(projectRoot(), 'scripts', 'apply-update.mjs'), staged],
				{ cwd: projectRoot(), detached: true, stdio: 'ignore', windowsHide: true }
			);

			helper.unref();
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Finish an update that never got its chance, on the way out.
	 *
	 * The swap needs this app closed. Doing it on quit covers the normal case;
	 * the check at startup below is what guarantees it eventually happens.
	 */
	function applyPendingUpdate() {
		// Somebody is already waiting for us to close — which is precisely what
		// we are doing. Another helper would only exit on their lock.
		if (helperWorking()) return;

		const pending = pendingUpdate();
		if (pending) startHelper(pending.staged);
	}

	app.on('before-quit', stopServer);
	app.on('quit', () => {
		stopServer();
		applyPendingUpdate();
	});
	// A crash or a force-close of the main process would otherwise orphan it.
	process.on('exit', () => server?.kill('SIGKILL'));
}
