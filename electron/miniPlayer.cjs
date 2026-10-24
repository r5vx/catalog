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
		fullscreenable: false,
		backgroundColor: '#000000',
		title: 'Catalog',
		icon,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false
		}
	});
	// Above other apps' windows, games' too (the plain "always on top" level isn't, on Windows).
	mini.setAlwaysOnTop(true, 'floating');
	mini.setAspectRatio(16 / 9);
	mini.loadURL(origin + path);

	const shown = mini;
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
			main.webContents
				.executeJavaScript(`window.catalogBackFromMini?.(${JSON.stringify(said)})`)
				.catch(() => {});
		}
	});
	main.minimize();
}

/** The mini player is done: back to the big window at `back.at` seconds, playing on or not. */
function closeMini(back) {
	if (!mini || mini.isDestroyed()) return;
	const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
	leaving = {
		at: number(back?.at) ?? null,
		playing: Boolean(back?.playing),
		season: number(back?.season),
		episode: number(back?.episode),
		fid: number(back?.fid)
	};
	mini.close();
}

module.exports = { openMini, closeMini };
