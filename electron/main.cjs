/**
 * The desktop wrapper.
 *
 * Catalog is a web app, so the "app" is just a plain window pointed at it. This
 * file starts the server quietly in the background, waits for it to answer,
 * and shows the window — so from your side it opens like any other program.
 */
const { app, BrowserWindow, shell, Menu } = require('electron');
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

	// Anything that isn't our own app opens in the real browser.
	window.webContents.setWindowOpenHandler(({ url }) => {
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
	 * Finish an update that never got its chance.
	 *
	 * The swap waits for this app to close. If someone reopens Catalog while it
	 * is waiting, that build is finished but unused — so on any later quit, a
	 * pending marker means we start the helper again rather than waste it.
	 */
	function applyPendingUpdate() {
		if (!SOURCE_MODE) return;

		const marker = path.join(projectRoot(), 'dist-staged', 'pending.txt');
		if (!fs.existsSync(marker)) return;

		try {
			const staged = fs.readFileSync(marker, 'utf8').trim();
			if (!staged) return;

			const helper = require('node:child_process').spawn(
				'node',
				[path.join(projectRoot(), 'scripts', 'apply-update.mjs'), staged],
				{ cwd: projectRoot(), detached: true, stdio: 'ignore', windowsHide: true }
			);

			helper.unref();
		} catch {
			// Nothing to do on the way out. It stays pending for next time.
		}
	}

	app.on('before-quit', stopServer);
	app.on('quit', () => {
		stopServer();
		applyPendingUpdate();
	});
	// A crash or a force-close of the main process would otherwise orphan it.
	process.on('exit', () => server?.kill('SIGKILL'));
}
