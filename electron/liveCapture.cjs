/**
 * Live TV (src/lib/server/sources/daddylive.ts): a channel's stream address, read the way Movy's
 * is. Its player works out the address in scrambled script while it runs, and only inside the
 * site's own page. So that page is opened out of sight, muted, with its adverts refused and its
 * redirects stopped (an advert sent the page to a game's website), and the first playlist it
 * asks for is noted with the headers it was asked with. The address carries a token good for
 * about two minutes; the server asks again before it runs out.
 */
const { BrowserWindow, session } = require('electron');

/** Advert and tracking hosts seen on the page (2026-10-24), refused outright. */
const ADVERTS = /(^|\.)(ads?|pop|track|histats|profitable|scatter|aclib|doubleclick|googlesyndication|adsterra|monetag|rtmark|connatix|rapidadexchange|usrpubtrck|luugy|llvpn|jwpltx)/i;
/** A playlist's address ends in .m3u8 (not just mentions one, as the player's analytics pings do). */
const isPlaylist = (url) => {
	try {
		return new URL(url).pathname.endsWith('.m3u8');
	} catch {
		return false;
	}
};

/** One look at a time per page. */
const looking = new Map();

/** `{ url, headers }` for the stream on `page`, or `{ error }`. */
function captureLive(page, referrer) {
	if (looking.has(page)) return looking.get(page);
	const result = look(page, referrer).finally(() => looking.delete(page));
	looking.set(page, result);
	return result;
}

/**
 * The pages being read, by their window's webContents id. One pair of request hooks serves them
 * all: hooks belong to the whole session, so each look setting its own (and clearing them when
 * done) left a second channel read at the same time without any, and it never found its stream.
 */
const reading = new Map();
let hooked = false;
function hook(ses) {
	if (hooked) return;
	hooked = true;
	ses.webRequest.onBeforeRequest((details, done) => {
		let host = '';
		try {
			host = new URL(details.url).host;
		} catch {}
		const look = reading.get(details.webContentsId);
		if (look && !look.found && isPlaylist(details.url)) look.found = details.url;
		done({ cancel: ADVERTS.test(host.split('.')[0]) || ADVERTS.test(host) });
	});
	ses.webRequest.onBeforeSendHeaders((details, done) => {
		const look = reading.get(details.webContentsId);
		if (look && isPlaylist(details.url)) {
			const h = details.requestHeaders;
			look.headers.set(details.url, { Referer: h.Referer ?? h.referer, Origin: h.Origin ?? h.origin, 'User-Agent': h['User-Agent'] });
		}
		done({ requestHeaders: details.requestHeaders });
	});
}

async function look(page, referrer) {
	const ses = session.fromPartition('live');
	hook(ses);
	const site = new URL(page).host;
	const win = new BrowserWindow({ show: false, width: 960, height: 540, webPreferences: { session: ses, backgroundThrottling: false } });
	const id = win.webContents.id;
	const found = { found: null, headers: new Map() };
	reading.set(id, found);
	win.webContents.setAudioMuted(true);
	win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	// The page itself stays put (adverts navigate it away).
	win.webContents.on('will-navigate', (event, url) => {
		try {
			if (new URL(url).host !== site) event.preventDefault();
		} catch {
			event.preventDefault();
		}
	});
	try {
		win.loadURL(page, referrer ? { httpReferrer: referrer } : undefined).catch(() => {});
		const started = Date.now();
		while (!found.found && Date.now() - started < 25_000 && !win.isDestroyed()) await new Promise((r) => setTimeout(r, 200));
		if (!found.found) return { error: 'no stream found' };
		// The headers come a moment after the request itself.
		for (let i = 0; i < 10 && !found.headers.has(found.found); i++) await new Promise((r) => setTimeout(r, 100));
		const h = found.headers.get(found.found) ?? {};
		return { url: found.found, headers: Object.fromEntries(Object.entries(h).filter(([, v]) => v)) };
	} finally {
		reading.delete(id);
		if (!win.isDestroyed()) win.destroy();
	}
}

module.exports = { captureLive };
