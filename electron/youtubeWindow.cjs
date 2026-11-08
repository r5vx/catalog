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
 *
 * Tabs, as in Chrome (owner, 2026-11-08): a strip across the top, in both ways of showing it.
 * + or Ctrl+T opens one, Ctrl+W closes one, Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+1-9 move between
 * them; Ctrl+click or a middle click on a link opens it in a new tab behind, and right-clicking a
 * link offers it too. Each tab is a page of its own (with the no-ads script), sharing the sign-in.
 * Closing YouTube closes every tab but the first, which goes back to the home page.
 */
const { app, BrowserWindow, WebContentsView, Menu, clipboard, session, shell } = require('electron');
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
	if (inside) inside.tabs.destroy();
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
function setUpPage(page, owner, goBackToCatalog, tabs = null) {
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
	// Ctrl+click and middle clicks ask for a tab behind ("background-tab"), Ctrl+Shift+click one in front.
	page.setWindowOpenHandler(({ url, disposition }) => {
		if (url === BACK_TO_CATALOG) goBackToCatalog?.();
		else if (SIGN_IN.test(url)) signIn(url);
		else if (OWN.test(url) && tabs && /tab|window/.test(disposition)) tabs.open(url, disposition !== 'background-tab');
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
		else if (!tabs || !tabs.key(input)) return;
		event.preventDefault();
	});

	// Right-clicking a link: open it in a new tab, or copy its address.
	page.on('context-menu', (_event, params) => {
		if (!tabs || !params.linkURL || !OWN.test(params.linkURL)) return;
		const link = params.linkURL;
		Menu.buildFromTemplate([
			{ label: 'Open link in new tab', click: () => tabs.open(link, false) },
			{ label: 'Copy link address', click: () => clipboard.writeText(link) }
		]).popup({ window: owner() ?? undefined });
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

/* ------------------------------------------------------------ tabs */

/** The tab strip's height, in pixels. */
const STRIP = 36;

/*
 * The tab strip: a small page drawn from what's sent to it (render), asking for things by opening
 * "about:blank#tabs:<what>:<tab>", which is caught and never opened (like the pink circle).
 */
const STRIP_PAGE =
	'data:text/html;charset=utf-8,' +
	encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>Tabs</title>
<style>
	html, body { margin: 0; height: 100%; background: #0f0f0f; color: #f1f1f1; font: 12.5px system-ui, 'Segoe UI', sans-serif; overflow: hidden; user-select: none; }
	#bar { display: flex; align-items: center; gap: 4px; height: 100%; padding: 0 8px; box-sizing: border-box; }
	#tabs { display: flex; align-items: center; gap: 4px; min-width: 0; flex: 0 1 auto; overflow: hidden; }
	.tab { display: flex; align-items: center; gap: 8px; flex: 0 1 220px; min-width: 44px; height: 28px; padding: 0 6px 0 10px; box-sizing: border-box; border-radius: 8px; color: #aaa; cursor: default; }
	.tab:hover { background: #1f1f1f; color: #f1f1f1; }
	.tab.on { background: #272727; color: #f1f1f1; }
	.tab img, .tab .dot { width: 16px; height: 16px; flex: none; border-radius: 3px; }
	.tab .dot { background: #3f3f3f; }
	.tab .dot.loading { background: none; border: 2px solid #3f3f3f; border-top-color: #e994c2; border-radius: 50%; width: 12px; height: 12px; animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.tab .name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.tab svg { flex: none; }
	.tab .x { flex: none; width: 20px; height: 20px; border: 0; padding: 0; border-radius: 50%; background: none; color: inherit; display: grid; place-items: center; cursor: pointer; }
	.tab .x:hover { background: #3f3f3f; }
	.tab.narrow .name, .tab.narrow .sound { display: none; }
	.tab.narrow:not(.on) .x { display: none; }
	#add, #back { flex: none; width: 28px; height: 28px; border: 0; padding: 0; border-radius: 50%; background: none; color: #f1f1f1; display: grid; place-items: center; cursor: pointer; }
	#add:hover { background: #272727; }
	#back { background: #e994c2; color: #141414; margin-right: 6px; width: 26px; height: 26px; }
	#back[hidden] { display: none; }
	#rest { flex: 1; align-self: stretch; }
	svg path { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
</style>
<div id="bar">
	<button id="back" title="Back to Catalog" hidden><svg viewBox="0 0 24 24" width="14" height="14"><path d="M15 5l-7 7 7 7" stroke-width="3"/></svg></button>
	<div id="tabs"></div>
	<button id="add" title="New tab (Ctrl+T)"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 5v14M5 12h14"/></svg></button>
	<div id="rest"></div>
</div>
<script>
	const ask = (what, id) => window.open('about:blank#tabs:' + what + ':' + (id || 0));
	const NS = 'http://www.w3.org/2000/svg';
	const icon = (d, size) => {
		const svg = document.createElementNS(NS, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('width', size);
		svg.setAttribute('height', size);
		const path = document.createElementNS(NS, 'path');
		path.setAttribute('d', d);
		svg.appendChild(path);
		return svg;
	};
	document.getElementById('add').onclick = () => ask('new');
	document.getElementById('back').onclick = () => ask('catalog');
	document.getElementById('rest').ondblclick = () => ask('new');
	function render(state) {
		document.getElementById('back').hidden = !state.back;
		const list = document.getElementById('tabs');
		list.replaceChildren();
		const narrow = state.tabs.length > 8;
		for (const tab of state.tabs) {
			const item = document.createElement('div');
			item.className = 'tab' + (tab.id === state.active ? ' on' : '') + (narrow ? ' narrow' : '');
			item.title = tab.title;
			item.onmousedown = (event) => {
				if (event.button === 0) ask('select', tab.id);
				if (event.button === 1) { event.preventDefault(); ask('close', tab.id); }
			};
			if (tab.icon && !tab.loading) {
				const img = document.createElement('img');
				img.src = tab.icon;
				img.onerror = () => img.replaceWith(Object.assign(document.createElement('span'), { className: 'dot' }));
				item.appendChild(img);
			} else {
				item.appendChild(Object.assign(document.createElement('span'), { className: 'dot' + (tab.loading ? ' loading' : '') }));
			}
			item.appendChild(Object.assign(document.createElement('span'), { className: 'name', textContent: tab.title }));
			if (tab.audible) {
				const sound = icon('M4 9v6h4l5 4V5L8 9H4zM16 8.5a5 5 0 0 1 0 7', 14);
				sound.classList.add('sound');
				item.appendChild(sound);
			}
			const close = document.createElement('button');
			close.className = 'x';
			close.title = 'Close tab (Ctrl+W)';
			close.appendChild(icon('M7 7l10 10M17 7L7 17', 12));
			close.onmousedown = (event) => event.stopPropagation();
			close.onclick = () => ask('close', tab.id);
			item.appendChild(close);
			list.appendChild(item);
		}
	}
</script>`);

/**
 * YouTube's tabs in `host` (its own window, or Catalog's window): the strip across the top and a
 * page per tab under it. `insideCatalog` adds the way back to Catalog (`goBackToCatalog`);
 * `onEmpty` is closing the last tab.
 */
function makeTabs(host, { insideCatalog = false, goBackToCatalog = null, onEmpty }) {
	const strip = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
	strip.setBackgroundColor('#0f0f0f');
	const group = { host, strip, tabs: [], active: null, attached: false, fullScreen: false, destroyed: false };
	let nextId = 1;
	let stripReady = false;
	let drawTimer = null;

	const draw = () => {
		if (!stripReady || strip.webContents.isDestroyed()) return;
		const state = {
			back: insideCatalog,
			active: group.active?.id ?? 0,
			tabs: group.tabs.map(({ id, title, icon, audible, loading }) => ({ id, title, icon, audible, loading }))
		};
		strip.webContents.executeJavaScript(`render(${JSON.stringify(state)})`).catch(() => {});
		// Its own window is named after the tab showing (the taskbar shows it).
		if (!insideCatalog && !host.isDestroyed() && group.active) host.setTitle(`${group.active.title} - YouTube`);
	};
	const drawSoon = () => {
		clearTimeout(drawTimer);
		drawTimer = setTimeout(draw, 30);
	};

	const shown = () => group.attached && !host.isDestroyed() && host.isVisible() && !host.isMinimized();

	/** Only the tab showing (and any playing sound) runs at full speed. */
	const pace = () => {
		for (const tab of group.tabs) {
			if (!tab.page.isDestroyed()) tab.page.setBackgroundThrottling(!(shown() && (tab === group.active || tab.audible)));
		}
	};

	const layout = () => {
		if (!group.attached || host.isDestroyed()) return;
		const [width, height] = host.getContentSize();
		const top = group.fullScreen ? 0 : STRIP;
		strip.setVisible(!group.fullScreen);
		strip.setBounds({ x: 0, y: 0, width, height: STRIP });
		for (const tab of group.tabs) {
			tab.view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
			tab.view.setVisible(tab === group.active);
		}
	};

	const select = (tab) => {
		if (!tab || tab.page.isDestroyed()) return;
		group.active = tab;
		group.fullScreen = false;
		layout();
		pace();
		if (shown()) tab.page.focus();
		drawSoon();
	};

	const api = {
		open: (url, activate) => open(url, activate),
		key: (input) => key(input)
	};

	/** A new tab on `url`; `activate` shows it (otherwise it opens behind, after the one showing). */
	function open(url = WEBSITE, activate = true, last = false) {
		const view = new WebContentsView({ webPreferences: WEB_PREFERENCES });
		view.setBackgroundColor('#0f0f0f');
		const page = view.webContents;
		const tab = { id: nextId++, view, page, title: 'YouTube', icon: '', audible: false, loading: true, controls: null };
		tab.controls = setUpPage(page, () => (host.isDestroyed() ? null : host), goBackToCatalog, api);
		tab.controls.whenShowing(() => group.active === tab && shown());

		page.on('page-title-updated', (_event, title) => {
			tab.title = title.replace(/ - YouTube$/, '') || 'YouTube';
			drawSoon();
		});
		page.on('page-favicon-updated', (_event, icons) => {
			tab.icon = icons[0] || '';
			drawSoon();
		});
		page.on('audio-state-changed', (event) => {
			tab.audible = Boolean(event.audible);
			pace();
			drawSoon();
		});
		page.on('did-start-loading', () => {
			tab.loading = true;
			drawSoon();
		});
		page.on('did-stop-loading', () => {
			tab.loading = false;
			drawSoon();
		});
		// YouTube's own full screen: the tab covers everything, strip too (Electron fills the screen
		// with the window by itself).
		page.on('enter-html-full-screen', () => {
			if (group.active !== tab) return;
			group.fullScreen = true;
			layout();
		});
		page.on('leave-html-full-screen', () => {
			group.fullScreen = false;
			layout();
		});
		if (insideCatalog) page.on('dom-ready', () => page.executeJavaScript(BACK_BUTTON).catch(() => {}));

		// Opened from a link: right after the tab showing (and any opened from it before), as in Chrome.
		const at = group.active && !last ? group.tabs.indexOf(group.active) + 1 : group.tabs.length;
		let spot = at;
		while (!last && spot < group.tabs.length && group.tabs[spot].openedFrom === group.active?.id) spot++;
		tab.openedFrom = last ? 0 : (group.active?.id ?? 0);
		group.tabs.splice(spot, 0, tab);
		if (group.attached) host.contentView.addChildView(view);
		page.setBackgroundThrottling(true);
		page.loadURL(url).catch(() => {});
		if (activate || !group.active) select(tab);
		else {
			layout();
			drawSoon();
		}
		return tab;
	}

	/** Closes a tab; the last one closes YouTube instead. */
	function close(tab) {
		if (!tab) return;
		if (group.tabs.length <= 1) {
			onEmpty();
			return;
		}
		const index = group.tabs.indexOf(tab);
		if (index === -1) return;
		group.tabs.splice(index, 1);
		if (group.attached && !host.isDestroyed()) host.contentView.removeChildView(tab.view);
		if (!tab.page.isDestroyed()) tab.page.close();
		if (group.active === tab) select(group.tabs[Math.min(index, group.tabs.length - 1)]);
		else drawSoon();
	}

	const step = (by) => {
		if (group.tabs.length < 2) return;
		const index = group.tabs.indexOf(group.active);
		select(group.tabs[(index + by + group.tabs.length) % group.tabs.length]);
	};

	/** The tab keys, as in Chrome. True when the key was one of them. */
	function key(input) {
		if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return false;
		const k = input.key.toLowerCase();
		if (k === 't' && !input.shift) open(WEBSITE, true, true);
		else if ((k === 'w' && !input.shift) || k === 'f4') close(group.active);
		else if (k === 'tab') step(input.shift ? -1 : 1);
		else if (k === 'pagedown') step(1);
		else if (k === 'pageup') step(-1);
		else if (/^[1-8]$/.test(k)) select(group.tabs[Number(k) - 1]);
		else if (k === '9') select(group.tabs[group.tabs.length - 1]);
		else return false;
		return true;
	}

	strip.webContents.setWindowOpenHandler(({ url }) => {
		const asked = /#tabs:(\w+):(\d+)/.exec(url);
		if (asked) {
			const tab = group.tabs.find((t) => t.id === Number(asked[2]));
			if (asked[1] === 'new') open(WEBSITE, true, true);
			else if (asked[1] === 'select') select(tab);
			else if (asked[1] === 'close') close(tab);
			else if (asked[1] === 'catalog') goBackToCatalog?.();
		}
		return { action: 'deny' };
	});
	strip.webContents.on('before-input-event', (event, input) => {
		if (key(input)) event.preventDefault();
	});
	strip.webContents.on('did-finish-load', () => {
		stripReady = true;
		draw();
	});
	strip.webContents.loadURL(STRIP_PAGE).catch(() => {});

	// The window changing size (or filling the screen): the tabs follow.
	const onResize = () => layout();
	host.on('resize', onResize);
	host.on('enter-full-screen', onResize);
	host.on('leave-full-screen', onResize);
	// The mouse's side buttons, while YouTube is showing.
	const onCommand = (_event, command) => {
		if (!group.attached || !group.active) return;
		if (command === 'browser-backward') group.active.controls.back();
		if (command === 'browser-forward') group.active.controls.forward();
	};
	host.on('app-command', onCommand);
	const onShowChange = () => pace();
	host.on('show', onShowChange);
	host.on('hide', onShowChange);
	host.on('minimize', onShowChange);
	host.on('restore', onShowChange);

	open(WEBSITE, true, true);

	return Object.assign(group, {
		open,
		focus: () => group.active && !group.active.page.isDestroyed() && group.active.page.focus(),
		/** Put on the window (the strip, then every tab). */
		attach() {
			if (group.attached || host.isDestroyed()) return;
			host.contentView.addChildView(strip);
			for (const tab of group.tabs) host.contentView.addChildView(tab.view);
			group.attached = true;
			layout();
			pace();
		},
		/** Taken off the window (inside Catalog: back to Catalog's own page). */
		detach() {
			if (!group.attached) return;
			group.attached = false;
			if (!host.isDestroyed()) {
				host.contentView.removeChildView(strip);
				for (const tab of group.tabs) host.contentView.removeChildView(tab.view);
			}
			pace();
		},
		/** Ready for next time: every tab but the first closed, and that one on the home page (the video stops). */
		reset() {
			for (const tab of group.tabs.slice(1)) {
				if (group.attached && !host.isDestroyed()) host.contentView.removeChildView(tab.view);
				if (!tab.page.isDestroyed()) tab.page.close();
			}
			group.tabs.length = Math.min(group.tabs.length, 1);
			group.fullScreen = false;
			const first = group.tabs[0];
			if (first && !first.page.isDestroyed()) {
				first.title = 'YouTube';
				first.page.loadURL(WEBSITE).catch(() => {});
			}
			select(first);
		},
		/** Gone for good (Catalog quitting, or switching between the two ways of showing YouTube). */
		destroy() {
			if (group.destroyed) return;
			group.detach();
			group.destroyed = true;
			clearTimeout(drawTimer);
			host.removeListener('resize', onResize);
			host.removeListener('enter-full-screen', onResize);
			host.removeListener('leave-full-screen', onResize);
			host.removeListener('app-command', onCommand);
			for (const name of ['show', 'hide', 'minimize', 'restore']) host.removeListener(name, onShowChange);
			for (const tab of group.tabs) if (!tab.page.isDestroyed()) tab.page.close();
			group.tabs.length = 0;
			if (!strip.webContents.isDestroyed()) strip.webContents.close();
		}
	});
}

/* ------------------------------------------------------------ its own window */

/** The window, made hidden and loading YouTube's home page in its first tab. */
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
		// Its own page is only the background behind the tabs.
		webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
	});
	const shown = win;
	shown.setMenuBarVisibility(false);
	const tabs = makeTabs(shown, { onEmpty: () => shown.close() });
	shown.tabs = tabs;
	tabs.attach();

	// Closing hides it, back to one tab on the home page (the video stops, and it's ready for next
	// time). Catalog quitting closes it for real.
	shown.on('close', (event) => {
		if (quitting) return;
		event.preventDefault();
		if (shown.isFullScreen()) shown.setFullScreen(false);
		shown.hide();
		tabs.reset();
	});
	shown.on('show', () => {
		tabs.focus();
		tell(true);
	});
	shown.on('hide', () => tell(false));
	shown.on('closed', () => {
		tabs.destroy();
		if (win === shown) win = null;
		tell(false);
	});
	shown.loadURL('about:blank').catch(() => {});
	return shown;
}

function dropWindow() {
	if (!win || win.isDestroyed()) return;
	const closing = win;
	win = null;
	closing.removeAllListeners('close');
	closing.tabs?.destroy();
	closing.destroy();
}

/* ------------------------------------------------------------ inside Catalog's window */

/** YouTube's tabs for Catalog's window, made hidden (not on the window yet) and loading. */
function makeInside(host) {
	const here = { host, tabs: null, attached: false };
	inside = here;
	here.tabs = makeTabs(host, { insideCatalog: true, goBackToCatalog: () => hideInside(), onEmpty: () => hideInside() });
	host.once('closed', () => {
		here.tabs.destroy();
		if (inside === here) inside = null;
	});
	return here;
}

function showInside(host) {
	if (!inside || inside.host !== host || inside.tabs.destroyed) {
		dropInside();
		makeInside(host);
	}
	const here = inside;
	if (host.isMinimized()) host.restore();
	here.tabs.attach();
	here.attached = true;
	host.show();
	host.focus();
	here.tabs.focus();
	tell(true);
}

/** Back to Catalog: one tab on YouTube's home page again (the video stops), ready for next time. */
function hideInside() {
	const here = inside;
	if (!here || !here.attached) return;
	if (!here.host.isDestroyed()) {
		// YouTube's own full screen fills Catalog's window: leaving YouTube leaves it too.
		if (here.tabs.fullScreen && here.host.isFullScreen()) here.host.setFullScreen(false);
		here.tabs.detach();
		here.host.webContents.focus();
	}
	here.attached = false;
	here.tabs.reset();
	tell(false);
}

function dropInside() {
	if (!inside) return;
	const here = inside;
	hideInside();
	inside = null;
	here.tabs.destroy();
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
