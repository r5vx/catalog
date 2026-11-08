/*
 * YouTube on the computer, opened from Catalog's YouTube page: YouTube's normal website
 * (youtube.com, the computer layout: mouse, keyboard, scroll), as in a browser. The TV layout is
 * only for the TVs. YouTube and Google see a plain Chrome on Windows.
 *
 * Two ways to show it (the switch on Catalog's YouTube page):
 *   - its own window (the default);
 *   - inside Catalog: YouTube covers the whole of Catalog's window, and a pink circle beside
 *     YouTube's logo goes back to Catalog (so do Alt+Left and the mouse's back button once there's
 *     nothing left to go back to in YouTube).
 *
 * Ads: the same script as the Fire TV app (android/assets/youtube-tv.js) asks YouTube for videos
 * without ads; a video ad that still comes is covered, muted and run at 16x, and its Skip button is
 * pressed here. F11 fills the screen, Alt+Left / Alt+Right and the mouse's side buttons go back and
 * forward, F5 reloads.
 *
 * Opening fast: once YouTube has been opened, Catalog loads it hidden a little after it starts
 * (prepareYouTube), the way it was last opened, and closing it only hides it (back to the home page,
 * so the video stops), so opening it again is instant. Catalog's YouTube page is told when it opens
 * and closes.
 *
 * Signing in: Google refuses its sign-in page inside an app ("This browser or app may not be
 * secure", proven 2026-11-04), so the website's Sign in (and Add account / Switch account) signs in
 * through the computer's own Edge or Chrome, in a window laid over this one that closes by itself
 * when Google is done; the sign-in is then moved in here (youtubeSignIn.cjs).
 *
 * Its own browser storage (`persist:youtube`), so a YouTube sign-in stays here (and in the hidden
 * window that plays YouTube for the Roku, youtubeHelper.cjs, which shares it) and nowhere else.
 */
const { app, BrowserWindow, WebContentsView, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { signInWithBrowser } = require('./youtubeSignIn.cjs');

const WEBSITE = 'https://www.youtube.com/';
const CHROME = (process.versions.chrome || '140.0.0.0').split('.')[0];
const AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME}.0.0.0 Safari/537.36`;
const SCRIPT = path.join(__dirname, '..', 'android', 'assets', 'youtube-tv.js');

// Pages that stay in YouTube; any other link opens in the computer's own browser.
const OWN = /^https:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be|google\.com|google\.[a-z.]+|gstatic\.com|googleusercontent\.com)(\/|$)/i;
// Google's sign-in pages (the website's Sign in, and YouTube sending someone there to subscribe, like…).
const SIGN_IN = /^https:\/\/accounts\.google\.com\/(ServiceLogin|AddSession|signin|v3\/signin|InteractiveLogin)/i;
// What the pink circle asks for (it opens this "page", which is caught and never opened).
const BACK_TO_CATALOG = 'about:blank#catalog-back';

const WEB_PREFERENCES = {
	partition: 'persist:youtube',
	// The script runs in the page's world (it has to reach YouTube's own page and player).
	// It uses nothing of the computer's (no Node).
	contextIsolation: false,
	sandbox: true,
	nodeIntegration: false,
	preload: SCRIPT,
	backgroundThrottling: false
};

let win = null; // its own window
let inside = null; // inside Catalog's window: { view, host }
let quitting = false;
let tell = () => {}; // Catalog's YouTube page: is YouTube open?

// Written each time YouTube is opened: from then on it's loaded ahead, hidden, the same way.
const usedFile = () => path.join(app.getPath('userData'), 'youtube-window.json');
const lastWay = () => {
	try {
		return JSON.parse(fs.readFileSync(usedFile(), 'utf8'));
	} catch {
		return null;
	}
};

app.on('before-quit', () => {
	quitting = true;
	// The sign-in and YouTube's settings: onto the disk now.
	try {
		const youtube = session.fromPartition('persist:youtube');
		youtube.flushStorageData();
		youtube.cookies.flushStore().catch(() => {});
	} catch {}
	// Inside Catalog: its page goes with Catalog's window.
	if (inside && !inside.view.webContents.isDestroyed()) inside.view.webContents.close();
});

/** A plain page while signing in, or when it can't. */
function notice(text, withCatalog) {
	const html = `<!doctype html><meta charset="utf-8"><title>YouTube</title>
<style>html,body{height:100%;margin:0;background:#0f0f0f;color:#f1f1f1;font:16px system-ui,sans-serif}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;text-align:center;padding:0 24px}
a{color:#3ea6ff;text-decoration:none}</style>
<p>${text}</p><a href="${WEBSITE}">Back to YouTube</a>${withCatalog ? `<a href="${BACK_TO_CATALOG}" target="_blank">Back to Catalog</a>` : ''}`;
	return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

/*
 * The pink circle beside YouTube's logo (inside Catalog only), put back whenever YouTube redraws
 * its top bar. Built element by element: YouTube's pages refuse HTML written as text (Trusted Types).
 */
const BACK_BUTTON = `(() => {
	if (window.__catalogBackButton) return;
	window.__catalogBackButton = true;
	const style = document.createElement('style');
	style.textContent = \`
		#catalog-back { flex: none; width: 30px; height: 30px; margin: 0 6px 0 14px; padding: 0; border: 0;
			border-radius: 50%; background: #e994c2; color: #141414; cursor: pointer; display: grid; place-items: center;
			box-shadow: 0 0 0 0 rgb(217 122 131 / 45%); transition: transform 0.15s ease, box-shadow 0.15s ease; }
		#catalog-back:hover { transform: scale(1.08); box-shadow: 0 0 0 5px rgb(217 122 131 / 22%); }
		#catalog-back:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
		#catalog-back svg { width: 16px; height: 16px; display: block; }\`;
	(document.head || document.documentElement).appendChild(style);
	const NS = 'http://www.w3.org/2000/svg';
	const make = () => {
		const button = document.createElement('button');
		button.id = 'catalog-back';
		button.type = 'button';
		button.title = 'Back to Catalog';
		button.setAttribute('aria-label', 'Back to Catalog');
		const svg = document.createElementNS(NS, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		const arrow = document.createElementNS(NS, 'path');
		arrow.setAttribute('d', 'M15 5l-7 7 7 7');
		arrow.setAttribute('fill', 'none');
		arrow.setAttribute('stroke', 'currentColor');
		arrow.setAttribute('stroke-width', '3');
		arrow.setAttribute('stroke-linecap', 'round');
		arrow.setAttribute('stroke-linejoin', 'round');
		svg.appendChild(arrow);
		button.appendChild(svg);
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			window.open('${BACK_TO_CATALOG}');
		}, true);
		return button;
	};
	const place = () => {
		const logo = document.querySelector('ytd-masthead #start ytd-topbar-logo-renderer');
		if (!logo) return;
		const button = document.getElementById('catalog-back') || make();
		if (logo.nextElementSibling !== button) logo.after(button);
	};
	place();
	setInterval(place, 500);
})()`;

/**
 * Everything YouTube's page does the same in its own window and inside Catalog: its links, the
 * sign-in, the keys, the Skip button. `owner()` is the window it's in; `goBackToCatalog` is set
 * inside Catalog only.
 */
function setUpPage(page, owner, goBackToCatalog) {
	page.setUserAgent(AGENT);

	/** Sign in through the computer's browser, then back to where YouTube was. */
	const signIn = async (url) => {
		const was = page.getURL();
		const back = /^https:\/\/(www\.)?youtube\.com\//i.test(was) ? was : WEBSITE;
		page.loadURL(notice('Signing in to YouTube…', false)).catch(() => {});
		const answer = await signInWithBrowser(url, owner());
		if (page.isDestroyed()) return;
		if (answer === 'signed-in' || answer === 'closed') page.loadURL(back).catch(() => {});
		else if (answer === 'no-browser') page.loadURL(notice('Signing in needs Microsoft Edge or Google Chrome on this computer.', !!goBackToCatalog)).catch(() => {});
		else page.loadURL(notice("The sign-in window couldn't be opened.", !!goBackToCatalog)).catch(() => {});
	};

	// Links YouTube opens in a new tab: YouTube/Google ones here, the rest in the computer's browser.
	page.setWindowOpenHandler(({ url }) => {
		if (url === BACK_TO_CATALOG) goBackToCatalog?.();
		else if (SIGN_IN.test(url)) signIn(url);
		else if (OWN.test(url)) page.loadURL(url);
		else if (/^https?:\/\//i.test(url)) shell.openExternal(url);
		return { action: 'deny' };
	});
	const leaving = (event, url) => {
		if (SIGN_IN.test(url)) {
			event.preventDefault();
			signIn(url);
			return;
		}
		if (OWN.test(url) || !/^https?:\/\//i.test(url)) return;
		event.preventDefault();
		shell.openExternal(url);
	};
	page.on('will-navigate', leaving);
	// A server sending the page itself on (not one of the frames inside it, like an ad's).
	page.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
		if (event.isMainFrame ?? isMainFrame) leaving(event, url);
	});

	// Back with nowhere left to go in YouTube: inside Catalog, that's back to Catalog.
	const back = () => {
		if (page.navigationHistory.canGoBack()) page.navigationHistory.goBack();
		else goBackToCatalog?.();
	};
	const forward = () => page.navigationHistory.canGoForward() && page.navigationHistory.goForward();
	page.on('before-input-event', (event, input) => {
		if (input.type !== 'keyDown') return;
		const shown = owner();
		if (input.key === 'F11' && shown) shown.setFullScreen(!shown.isFullScreen());
		else if (input.key === 'F5') page.reload();
		else if (input.alt && input.key === 'ArrowLeft') back();
		else if (input.alt && input.key === 'ArrowRight') forward();
		else return;
		event.preventDefault();
	});

	// A video ad's Skip button, pressed as soon as it shows (youtube-tv.js covers the ad, mutes it
	// and runs it at 16x; YouTube ignores a click made by a page's own script, so it's a real one).
	let showing = () => false;
	const pressSkip = async () => {
		if (page.isDestroyed() || !showing() || !/youtube\.com\/(watch|shorts)/.test(page.getURL())) return;
		const at = await page
			.executeJavaScript(`(() => {
				const player = document.getElementById('movie_player');
				if (!player || !player.classList.contains('ad-showing')) return null;
				const button = player.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
				const box = button && button.getBoundingClientRect();
				return box && box.width && box.height ? { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) } : null;
			})()`)
			.catch(() => null);
		if (!at || page.isDestroyed()) return;
		for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) page.sendInputEvent({ type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
	};
	const skipTimer = setInterval(pressSkip, 250);
	page.once('destroyed', () => clearInterval(skipTimer));

	return {
		back,
		forward,
		whenShowing(check) {
			showing = check;
		}
	};
}

/* ------------------------------------------------------------ its own window */

/** The window, made hidden and loading YouTube's home page. */
function makeWindow(icon) {
	win = new BrowserWindow({
		width: 1280,
		height: 800,
		minWidth: 640,
		minHeight: 400,
		show: false,
		title: 'YouTube',
		icon,
		backgroundColor: '#0f0f0f',
		autoHideMenuBar: true,
		webPreferences: WEB_PREFERENCES
	});
	const shown = win;
	const page = shown.webContents;
	shown.setMenuBarVisibility(false);
	const controls = setUpPage(page, () => (shown.isDestroyed() ? null : shown), null);
	controls.whenShowing(() => !shown.isDestroyed() && shown.isVisible());

	// The mouse's side buttons.
	shown.on('app-command', (_event, command) => {
		if (command === 'browser-backward') controls.back();
		if (command === 'browser-forward') controls.forward();
	});

	// Closing hides it, back on the home page (the video stops, and it's ready for next time).
	// Catalog quitting closes it for real.
	shown.on('close', (event) => {
		if (quitting) return;
		event.preventDefault();
		if (shown.isFullScreen()) shown.setFullScreen(false);
		shown.hide();
		page.loadURL(WEBSITE).catch(() => {});
	});
	shown.on('show', () => {
		page.setBackgroundThrottling(false);
		tell(true);
	});
	shown.on('hide', () => {
		page.setBackgroundThrottling(true);
		tell(false);
	});
	shown.on('closed', () => {
		if (win === shown) win = null;
		tell(false);
	});
	page.setBackgroundThrottling(true);
	shown.loadURL(WEBSITE).catch(() => {});
	return shown;
}

function dropWindow() {
	if (!win || win.isDestroyed()) return;
	const closing = win;
	win = null;
	closing.removeAllListeners('close');
	closing.destroy();
}

/* ------------------------------------------------------------ inside Catalog's window */

/** YouTube's page for Catalog's window, made hidden (not on the window yet) and loading. */
function makeInside(host) {
	const view = new WebContentsView({ webPreferences: WEB_PREFERENCES });
	view.setBackgroundColor('#0f0f0f');
	const page = view.webContents;
	const here = { view, host, attached: false, wentFullScreen: false };
	inside = here;

	const fit = () => {
		if (!here.attached || host.isDestroyed()) return;
		const [width, height] = host.getContentSize();
		view.setBounds({ x: 0, y: 0, width, height });
	};
	here.fit = fit;
	const controls = setUpPage(page, () => (host.isDestroyed() ? null : host), () => hideInside());
	controls.whenShowing(() => here.attached && !host.isDestroyed() && host.isVisible() && !host.isMinimized());

	// Catalog's window changing size (or filling the screen): YouTube still covers all of it.
	host.on('resize', fit);
	host.on('enter-full-screen', fit);
	host.on('leave-full-screen', fit);
	// The mouse's side buttons, while YouTube is showing.
	host.on('app-command', (_event, command) => {
		if (!here.attached) return;
		if (command === 'browser-backward') controls.back();
		if (command === 'browser-forward') controls.forward();
	});

	// YouTube's own full screen (its player's button, or f): Electron fills the screen with Catalog's
	// window by itself and back (checked 2026-11-06), and `fit` follows. Noted, so going back to
	// Catalog from full screen leaves it too.
	page.on('enter-html-full-screen', () => (here.wentFullScreen = true));
	page.on('leave-html-full-screen', () => (here.wentFullScreen = false));

	page.on('dom-ready', () => page.executeJavaScript(BACK_BUTTON).catch(() => {}));
	page.once('destroyed', () => {
		if (inside === here) inside = null;
	});
	host.once('closed', () => {
		if (!page.isDestroyed()) page.close();
	});

	page.setBackgroundThrottling(true);
	page.loadURL(WEBSITE).catch(() => {});
	return here;
}

function showInside(host) {
	if (!inside || inside.host !== host || inside.view.webContents.isDestroyed()) {
		dropInside();
		makeInside(host);
	}
	const here = inside;
	if (host.isMinimized()) host.restore();
	if (!here.attached) {
		host.contentView.addChildView(here.view);
		here.attached = true;
	}
	here.fit();
	here.view.webContents.setBackgroundThrottling(false);
	host.show();
	host.focus();
	here.view.webContents.focus();
	tell(true);
}

/** Back to Catalog: YouTube goes back to its home page (the video stops), ready for next time. */
function hideInside() {
	const here = inside;
	if (!here || !here.attached) return;
	const page = here.view.webContents;
	if (!here.host.isDestroyed()) {
		if (here.wentFullScreen && here.host.isFullScreen()) here.host.setFullScreen(false);
		here.wentFullScreen = false;
		here.host.contentView.removeChildView(here.view);
		here.host.webContents.focus();
	}
	here.attached = false;
	if (!page.isDestroyed()) {
		page.setBackgroundThrottling(true);
		page.loadURL(WEBSITE).catch(() => {});
	}
	tell(false);
}

function dropInside() {
	if (!inside) return;
	const here = inside;
	hideInside();
	inside = null;
	if (!here.view.webContents.isDestroyed()) here.view.webContents.close();
}

/* ------------------------------------------------------------ what main.cjs calls */

/**
 * Loads YouTube hidden, so opening it is instant. Only for someone who has opened YouTube before
 * (anyone else never pays for it), the way they last opened it; Catalog calls this a little after
 * it starts. `host` is Catalog's window.
 */
function prepareYouTube(icon, onChange, host) {
	if (onChange) tell = onChange;
	const last = lastWay();
	if (quitting || !last) return;
	if (last.inside) {
		if (host && !host.isDestroyed() && !inside) makeInside(host);
	} else if (!win || win.isDestroyed()) {
		makeWindow(icon);
	}
}

/** Opens (shows) YouTube: in its own window, or over all of Catalog's window (`inside`). */
function openYouTube(icon, onChange, { inside: overCatalog = false, host = null } = {}) {
	if (onChange) tell = onChange;
	if (quitting) return;
	const useInside = overCatalog && host && !host.isDestroyed();
	fs.writeFile(usedFile(), JSON.stringify({ used: new Date().toISOString(), inside: !!useInside }), () => {});
	if (useInside) {
		dropWindow();
		showInside(host);
		return;
	}
	dropInside();
	if (!win || win.isDestroyed()) {
		// Builds before this one kept the window in YouTube's TV layout after a sign-in; that's gone.
		fs.rm(path.join(app.getPath('userData'), 'youtube-layout.json'), { force: true }, () => {});
		makeWindow(icon);
	}
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
}

/** Is YouTube showing (its window, minimized counts; or over Catalog's window)? */
function youTubeOpen() {
	if (inside?.attached) return true;
	return !!(win && !win.isDestroyed() && win.isVisible());
}

module.exports = { openYouTube, prepareYouTube, youTubeOpen };
