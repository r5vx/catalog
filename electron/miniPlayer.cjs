/**
 * The mini player: a small Catalog window that stays on top of everything, in a corner of the
 * screen, playing on from where the big one was (the watch page with `mini=1`). Catalog's own
 * window is minimized meanwhile, and comes back where the mini player got to.
 *
 * It replaced the browser's picture-in-picture on the computer (2026-10-23). That one dimmed the
 * whole picture under its buttons, had only play/pause, and its look couldn't be changed. Phones
 * still use it.
 */
const { BrowserWindow, screen } = require('electron');

const WIDTH = 480;
const HEIGHT = 270;
const MARGIN = 24;

let mini = null;
/** Said by the mini player as it goes back: where it got to (episode, copy, place), and whether it was playing. */
let leaving = null;

/**
 * Opens the mini player on `path` (a /watch address) beside `main`, which is minimized.
 * `origin` is Catalog's own address, `icon` its window icon.
 */
function openMini(main, origin, path, icon) {
	if (!main || main.isDestroyed()) return;
	if (mini && !mini.isDestroyed()) {
		mini.focus();
		return;
	}
	const area = screen.getDisplayMatching(main.getBounds()).workArea;
	leaving = null;
	mini = new BrowserWindow({
		width: WIDTH,
		height: HEIGHT,
		x: area.x + area.width - WIDTH - MARGIN,
		y: area.y + area.height - HEIGHT - MARGIN,
		minWidth: 240,
		minHeight: 135,
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
	main.minimize();
}

/**
 * The mini player is done: back to the big window at `back.at` seconds, playing on or not.
 * `back.reopen` (its "Back to Catalog"): the player opens on `back.path` if Catalog's window is on
 * another page by now.
 */
function closeMini(back) {
	if (!mini || mini.isDestroyed()) return;
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
	mini.close();
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
