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

	server.on('message', (message) => {
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
		webPreferences: { nodeIntegration: false, contextIsolation: true }
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

		// Let febbox load inside an iframe in the Watch page.
		session.defaultSession.webRequest.onHeadersReceived(
			{ urls: ['*://*.febbox.com/*'] },
			(details, callback) => {
				const headers = { ...details.responseHeaders };
				delete headers['x-frame-options'];
				delete headers['X-Frame-Options'];
				delete headers['content-security-policy'];
				delete headers['Content-Security-Policy'];
				callback({ responseHeaders: headers });
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
