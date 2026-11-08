/*
 * Signing in to YouTube for the computer's YouTube window (youtubeWindow.cjs).
 *
 * Google refuses its sign-in page inside an app ("This browser or app may not be secure", proven
 * 2026-11-04 with Catalog's window), so the sign-in happens in the computer's own Microsoft Edge (or
 * Google Chrome), in a window of its own with its own empty profile (nothing of the person's
 * own browser is touched or read). Google sees a real browser there.
 *
 * Edge is started exactly as a person would start it (no DevTools port, no app window: with the
 * DevTools port open Google still refused it). Once the person has signed in and closed that window,
 * the same profile is opened once more, hidden, with a DevTools port on this computer only, to read
 * its cookies; Google's and YouTube's are copied into the YouTube window's storage
 * (`persist:youtube`) and the profile folder is deleted. From then on YouTube's normal website in
 * Catalog's window is signed in, as if the sign-in had happened there.
 */
const { app, session } = require('electron');
const { spawn } = require('node:child_process');
const { watchSignInWindow } = require('./signInWindow.cjs');
const fs = require('node:fs');
const path = require('node:path');

/** The browser to sign in with: Edge first on Windows (it's on every Windows), then Chrome. */
function findBrowser() {
	const env = process.env;
	const places =
		process.platform === 'win32'
			? [
					[env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'],
					[env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'],
					[env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'],
					[env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'],
					[env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'],
					[env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe']
				]
			: process.platform === 'darwin'
				? [
						['/Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'],
						['/Applications', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'],
						['/Applications', 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser']
					]
				: [
						['/usr/bin', 'google-chrome'],
						['/usr/bin', 'microsoft-edge'],
						['/usr/bin', 'chromium'],
						['/usr/bin', 'chromium-browser']
					];
	for (const parts of places) {
		if (!parts[0]) continue;
		const file = path.join(...parts);
		if (fs.existsSync(file)) return file;
	}
	return null;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The browser's DevTools address, from the file it writes into its profile folder. (Edge hands
 * itself over to a second copy of itself straight away, so the one started isn't the one to watch:
 * everything goes through this address instead.)
 */
async function devToolsAddress(profile, ms) {
	const file = path.join(profile, 'DevToolsActivePort');
	for (let waited = 0; waited < ms; waited += 250) {
		try {
			const [port, where] = fs.readFileSync(file, 'utf8').split(String.fromCharCode(10)); // (lines; each trimmed below)
			if (port && where) return `ws://127.0.0.1:${port.trim()}${where.trim()}`;
		} catch {}
		await wait(250);
	}
	return null;
}

/** A DevTools connection to the browser itself (no page). `send` answers with the result. */
function connect(address) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(address);
		const waiting = new Map();
		let next = 1;
		socket.onopen = () =>
			resolve({
				send(method, params = {}) {
					const id = next++;
					return new Promise((answer, fail) => {
						waiting.set(id, { answer, fail });
						socket.send(JSON.stringify({ id, method, params }));
					});
				},
				close: () => socket.close(),
				// The browser has gone (closed, or stopped).
				get gone() {
					return socket.readyState >= 2;
				}
			});
		socket.onerror = () => reject(new Error('DevTools connection failed'));
		socket.onmessage = (event) => {
			const message = JSON.parse(String(event.data));
			const asked = waiting.get(message.id);
			if (!asked) return;
			waiting.delete(message.id);
			if (message.error) asked.fail(new Error(message.error.message));
			else asked.answer(message.result);
		};
		socket.onclose = () => {
			for (const { fail } of waiting.values()) fail(new Error('DevTools connection closed'));
			waiting.clear();
		};
	});
}

const GOOGLE = /(^|\.)(google\.[a-z.]+|youtube\.com)$/i;

/** Signed in: Google's session cookie is there for youtube.com (the end of Google's sign-in). */
const signedIn = (cookies) => cookies.some((c) => c.name === 'SID' && /(^|\.)youtube\.com$/i.test(c.domain));

/**
 * Where a profile's YouTube sign-in is kept: the owner's is the computer's YouTube window's own
 * (`persist:youtube`); everyone else's has its own, used by their phones (main.cjs hands it to
 * src/lib/server/youtubePhone.ts).
 */
function youtubePartition(profile) {
	const id = Number(profile) || 0;
	return id === 0 ? 'persist:youtube' : `persist:youtube-p${id}`;
}

/** Google's and YouTube's cookies from the sign-in browser, into a YouTube storage. */
async function copyCookies(cookies, partition) {
	const jar = session.fromPartition(partition).cookies;
	// Old ones first (a guest's or a signed-out account's), so nothing of the old state is mixed in.
	for (const old of await jar.get({})) {
		if (!GOOGLE.test(old.domain.replace(/^\./, ''))) continue;
		const host = old.domain.replace(/^\./, '');
		await jar.remove(`http${old.secure ? 's' : ''}://${host}${old.path || '/'}`, old.name).catch(() => {});
	}
	let copied = 0;
	for (const c of cookies) {
		const host = c.domain.replace(/^\./, '');
		if (!GOOGLE.test(host) || c.partitionKey) continue;
		const cookie = {
			url: `https://${host}${c.path || '/'}`,
			name: c.name,
			value: c.value,
			path: c.path || '/',
			secure: c.secure,
			httpOnly: c.httpOnly,
			sameSite: c.sameSite === 'None' ? 'no_restriction' : c.sameSite === 'Lax' ? 'lax' : c.sameSite === 'Strict' ? 'strict' : 'unspecified'
		};
		// A leading dot means the whole site; without one the cookie is for that one host (and
		// __Host- cookies must have no domain at all).
		if (c.domain.startsWith('.') && !c.name.startsWith('__Host-')) cookie.domain = c.domain;
		if (!c.session && c.expires > 0) cookie.expirationDate = c.expires;
		try {
			await jar.set(cookie);
			copied++;
		} catch {}
	}
	await jar.flushStore().catch(() => {});
	return copied;
}

function removeProfile(profile) {
	// The browser may hold its files a moment after it closes.
	const attempt = (left) => {
		try {
			fs.rmSync(profile, { recursive: true, force: true });
		} catch {
			if (left > 0) setTimeout(() => attempt(left - 1), 1000);
		}
	};
	attempt(30);
}

/** Whether a browser still holds the profile folder (another copy of it, or this one closing). */
function profileInUse(profile) {
	return ['lockfile', 'SingletonLock'].some((name) => {
		try {
			fs.lstatSync(path.join(profile, name));
			return true;
		} catch {
			return false;
		}
	});
}

let running = null;

/**
 * Google's sign-in, coming back to YouTube's "You" page: its title ("You - YouTube") is how the
 * sign-in window is known to be done (signInWindow.cjs). The window's profile is new and empty, so
 * Sign in, Add account and Switch account are all the same full sign-in there.
 */
function signInAddress(asked) {
	const language = (() => {
		try {
			return new URL(asked).searchParams.get('hl') || 'en';
		} catch {
			return 'en';
		}
	})();
	const back = `https://www.youtube.com/signin?action_handle_signin=true&app=desktop&hl=${language}&next=${encodeURIComponent('https://www.youtube.com/feed/you')}`;
	return `https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&hl=${language}&continue=${encodeURIComponent(back)}`;
}

/**
 * Signs in to YouTube in the computer's browser. `url` is Google's sign-in address as YouTube's
 * website asked for it; `owner` is the YouTube window: the sign-in window is put over it and stays
 * with it, and closes by itself once Google is done (signInWindow.cjs). Answers 'signed-in',
 * 'closed' (the window was closed before signing in), 'no-browser', or 'failed'. Only one at a
 * time: asking again brings the same one back.
 */
function signInWithBrowser(url, owner = null, partition = 'persist:youtube') {
	if (running) return running;
	running = (async () => {
		const browser = findBrowser();
		if (!browser) return 'no-browser';
		// A new empty profile each time (an old one may still be held for a moment by a browser that
		// just closed); ones left from before are cleared away.
		const folder = path.join(app.getPath('userData'), 'youtube-sign-in');
		for (const old of fs.existsSync(folder) ? fs.readdirSync(folder) : []) {
			if (!profileInUse(path.join(folder, old))) removeProfile(path.join(folder, old));
		}
		const profile = path.join(folder, String(Date.now()));
		fs.mkdirSync(profile, { recursive: true });
		// No DevTools port while Google's page is open: with one (the first version) Google said "This
		// browser or app may not be secure" even in the real Edge (owner, 2026-11-04). An app window
		// (no tabs or address bar) exactly over the YouTube window's page.
		const where = [];
		if (owner && !owner.isDestroyed()) {
			const b = owner.getContentBounds();
			where.push(`--window-position=${b.x},${b.y}`, `--window-size=${b.width},${b.height}`);
		}
		spawn(browser, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...where, `--app=${signInAddress(url)}`], {
			stdio: 'ignore'
		}).on('error', () => {});
		const stopWatching = watchSignInWindow(profile, owner);
		let devTools = null;
		try {
			// Open: the browser holds its profile (a lock file in it) from start to close. Edge hands
			// itself to a second copy of itself straight away, so the process started can't be watched.
			let opened = false;
			for (let i = 0; i < 80 && !opened; i++) {
				await wait(250);
				opened = profileInUse(profile);
			}
			if (!opened) return 'failed';
			// Until its window is closed (Edge then quits: checked 2026-11-04). Two hours at most. Free for
			// 3 s in a row: while Edge hands itself over to its second copy the folder is free a moment.
			let free = 0;
			for (let i = 0; i < 7200 * 4 && free < 12; i++) {
				await wait(250);
				free = profileInUse(profile) ? 0 : free + 1;
			}
			if (free < 12) return 'closed';

			// Then the same profile is opened once more, hidden, only to read its cookies.
			try {
				fs.rmSync(path.join(profile, 'DevToolsActivePort'), { force: true });
			} catch {}
			spawn(browser, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', 'about:blank'], {
				stdio: 'ignore'
			}).on('error', () => {});
			const address = await devToolsAddress(profile, 20000);
			if (!address) return 'failed';
			devTools = await connect(address);
			const { cookies } = await devTools.send('Storage.getCookies');
			if (!signedIn(cookies)) return 'closed';
			await copyCookies(cookies, partition);
			return 'signed-in';
		} catch {
			return 'failed';
		} finally {
			stopWatching();
			if (devTools) {
				await devTools.send('Browser.close').catch(() => {});
				devTools.close();
			}
			removeProfile(profile);
		}
	})().finally(() => {
		running = null;
	});
	return running;
}

/** Signs a profile's YouTube storage out: Google's and YouTube's cookies go. */
async function signOutOf(partition) {
	const jar = session.fromPartition(partition).cookies;
	for (const old of await jar.get({})) {
		const host = old.domain.replace(/^\./, '');
		if (!GOOGLE.test(host)) continue;
		await jar.remove(`http${old.secure ? 's' : ''}://${host}${old.path || '/'}`, old.name).catch(() => {});
	}
	await jar.flushStore().catch(() => {});
}

module.exports = { signInWithBrowser, signOutOf, youtubePartition, findBrowser };
