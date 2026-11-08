/**
 * The mini player: a small Catalog window that stays on top of everything, in a corner of the
 * screen, playing on from where the big one was (the watch page with `mini=1`). Catalog's own
 * window is minimized meanwhile, and comes back where the mini player got to.
 *
 * It replaced the browser's picture-in-picture on the computer (2026-10-23). That one dimmed the
 * whole picture under its buttons, had only play/pause, and its look couldn't be changed. Phones
 * still use it.
 *
 * Nothing reloads in front of you: the mini window opens hidden and gets its video ready while the
 * big one plays on, then takes over at the very spot (and the same on the way back). A playing
 * video can't be moved to another window as it is: tried 2026-11-01 in Electron 38, a moved video
 * starts over from nothing, and the browser's document picture-in-picture opens an empty window.
 */
const { BrowserWindow, screen } = require('electron');

const WIDTH = 480;
const HEIGHT = 270;
const MARGIN = 24;

let mini = null;
/** Catalog's own window, which opened it. */
let opener = null;
/** Said by the mini player as it goes back: where it got to (episode, copy, place), and whether it was playing. */
let leaving = null;
/** Still hidden, getting ready; or on its way back. */
let readying = false;
let goingBack = false;

/** How long the hidden mini player may take to get ready before it's shown anyway. */
const READY_WAIT = 15000;

const later = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs `code` in `win`'s page (as if clicked, so its sound may start); `fallback` when it fails or takes over `ms`. */
function ask(win, code, ms, fallback) {
	if (!win || win.isDestroyed()) return Promise.resolve(fallback);
	return Promise.race([win.webContents.executeJavaScript(code, true).catch(() => fallback), later(ms).then(() => fallback)]);
}

/**
 * Opens the mini player on `path` (a /watch address) beside `main`, which is minimized.
 * `origin` is Catalog's own address, `icon` its window icon.
 */
function openMini(main, origin, path, icon) {
	if (!main || main.isDestroyed()) return;
	if (mini && !mini.isDestroyed()) {
		if (!readying) mini.focus();
		return;
	}
	opener = main;
	const area = screen.getDisplayMatching(main.getBounds()).workArea;
	leaving = null;
	mini = new BrowserWindow({
		width: WIDTH,
		height: HEIGHT,
		x: area.x + area.width - WIDTH - MARGIN,
		y: area.y + area.height - HEIGHT - MARGIN,
		minWidth: 240,
		minHeight: 135,
		// Shown once its video is ready (handOver).
		show: false,
		frame: false,
		alwaysOnTop: true,
		// Its own fullscreen button: the picture fills that screen while Catalog is used on another.
		fullscreenable: true,
		backgroundColor: '#000000',
		title: 'Catalog',
		icon,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false
		}
	});
	keepOnTop(mini);
	// No fixed 16:9: with one, dragging a side grew the window diagonally. Black fills the rest.
	mini.loadURL(origin + path);

	const shown = mini;
	// A fullscreen game or app on that screen comes to the front when it's clicked: the mini player
	// goes back above it straight after.
	mini.on('blur', () => {
		setTimeout(() => {
			if (!shown.isDestroyed() && shown.isAlwaysOnTop() && !shown.isMinimized()) shown.moveTop();
		}, 150);
	});
	// Fullscreen, it's an ordinary window (Alt+Tab and Catalog's window go over it); back on top after.
	mini.on('enter-full-screen', () => shown.setAlwaysOnTop(false));
	mini.on('leave-full-screen', () => keepOnTop(shown));
	mini.on('closed', () => {
		if (mini === shown) mini = null;
		readying = false;
		goingBack = false;
		// Back to the big window: where the mini player got to (or, closed some other way, the
		// place it last saved, which the page looks up itself).
		const said = leaving;
		leaving = null;
		if (!main.isDestroyed()) {
			if (main.isMinimized()) main.restore();
			main.show();
			main.focus();
			// The player that opened it carries on. It's gone when Catalog was used meanwhile (another
			// page): "Back to Catalog" then opens the player there, at the place just saved.
			main.webContents
				.executeJavaScript(`window.catalogBackFromMini ? window.catalogBackFromMini(${JSON.stringify(said)}) : false`)
				.then((handled) => {
					if (!handled && said?.reopen && said.path && !main.isDestroyed()) main.loadURL(origin + said.path);
				})
				.catch(() => {});
		}
	});
	handOver(main, shown);
}

/**
 * Waits for the hidden mini player's video to be ready (or READY_WAIT), then: the big player stops
 * and says where it got to, the mini player starts from there, shows, and the big window minimizes.
 */
async function handOver(main, shown) {
	readying = true;
	const until = Date.now() + READY_WAIT;
	while (Date.now() < until && !shown.isDestroyed()) {
		const bigAt = await ask(main, 'window.catalogPlaceNow ? window.catalogPlaceNow() : null', 1000, null);
		if (await ask(shown, `Boolean(window.catalogMiniReady && window.catalogMiniReady(${JSON.stringify(bigAt)}))`, 1000, false)) break;
		await later(200);
	}
	if (shown.isDestroyed()) return;
	const handed = await ask(main, 'window.catalogHandToMini ? window.catalogHandToMini() : null', 2000, null);
	await ask(shown, `window.catalogMiniGo ? window.catalogMiniGo(${JSON.stringify(handed)}) : false`, 1500, false);
	readying = false;
	if (shown.isDestroyed()) return;
	shown.show();
	keepOnTop(shown);
	if (!main.isDestroyed()) main.minimize();
}

/**
 * The mini player is done: back to the big window at `back.at` seconds, playing on or not.
 * `back.reopen` (its "Back to Catalog"): the player opens on `back.path` if Catalog's window is on
 * another page by now.
 */
async function closeMini(back) {
	if (!mini || mini.isDestroyed() || goingBack) return;
	const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
	leaving = {
		at: number(back?.at) ?? null,
		playing: Boolean(back?.playing),
		reopen: Boolean(back?.reopen),
		path: typeof back?.path === 'string' && back.path.startsWith('/watch?') ? back.path : undefined,
		season: number(back?.season),
		episode: number(back?.episode),
		fid: number(back?.fid)
	};
	// Catalog's window gets that spot ready while the mini player plays on, then takes over from
	// wherever the mini player is by then. (Not when it's on another page, or the mini player went
	// to another episode: it opens that itself, as before.)
	const shown = mini;
	goingBack = true;
	if (!readying && leaving.at !== null && opener && !opener.isDestroyed()) {
		const ready = await ask(opener, `window.catalogPrepareBack ? window.catalogPrepareBack(${JSON.stringify(leaving)}) : false`, 7000, false);
		if (ready && leaving) {
			const now = await ask(shown, 'window.catalogMiniStop ? window.catalogMiniStop() : null', 1000, null);
			if (now && Number.isFinite(now.at)) leaving = { ...leaving, at: now.at };
		}
	}
	if (!shown.isDestroyed()) shown.close();
}

/**
 * Above every other window, games' and fullscreen apps' too. Not Electron's default level
 * ("floating"): on Windows that one is put behind the taskbar each time the window is clicked, and
 * with a fullscreen app on that screen, behind the app, so the mini player vanished when clicked.
 */
function keepOnTop(win) {
	win.setAlwaysOnTop(true, 'screen-saver');
}

module.exports = { openMini, closeMini };
