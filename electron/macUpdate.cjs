/**
 * Updating Catalog on a Mac, with no Terminal.
 *
 * The Windows updater (electron-updater) can't install on a Mac without an Apple developer
 * certificate, so Mac users used to download each new .dmg themselves — and a file a browser
 * downloads is marked "quarantined", which is why macOS then refused to open Catalog until
 * `xattr -cr` was typed into Terminal. A file Catalog downloads itself gets no such mark. So
 * here Catalog fetches the new version's app (Catalog-<version>-mac.zip, made by
 * .github/workflows/build-mac.yml), unpacks it next to nothing it's using, and, when asked to
 * install, swaps it in for itself and starts again (or, like on Windows, swaps it in when
 * Catalog is next closed). Only the very first install from a .dmg still needs the Terminal step.
 *
 * Reports the same states as the Windows updater (checking, downloading, ready, none, error).
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const RELEASES = 'https://github.com/r5vx/catalog/releases';

/** True if version a is later than version b ("3.2.0" > "3.1.4"). */
function isLater(a, b) {
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	for (let i = 0; i < 3; i++) {
		if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
	}
	return false;
}

function run(command, args) {
	return new Promise((resolve, reject) =>
		execFile(command, args, (error, stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve(stdout)))
	);
}

/** The Catalog.app Catalog is running from. */
function runningBundle() {
	return path.resolve(process.execPath, '../../..');
}

function createMacUpdater({ app, send, log }) {
	/** The downloaded version, unpacked and waiting: { version, bundle }. */
	let ready = null;
	let checking = false;
	const workDir = () => path.join(app.getPath('userData'), 'mac-update');

	/** Whether Catalog can swap itself where it is (not when run from the .dmg, say). */
	function canSwap() {
		const bundle = runningBundle();
		if (!bundle.endsWith('.app') || bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) return false;
		try {
			fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
			return true;
		} catch {
			return false;
		}
	}

	/** At start: what an earlier update left behind (the old copy, the download). */
	function tidy() {
		try {
			const folder = path.dirname(runningBundle());
			for (const name of fs.readdirSync(folder)) {
				if (/^\.Catalog-old-\d+\.app$/.test(name)) fs.rmSync(path.join(folder, name), { recursive: true, force: true });
			}
		} catch {}
		try {
			fs.rmSync(workDir(), { recursive: true, force: true });
		} catch {}
	}

	async function check() {
		if (ready) return send({ status: 'ready', version: ready.version });
		if (checking) return;
		checking = true;
		try {
			send({ status: 'checking' });
			// The Windows feed names the newest version; the Mac copy sits beside it.
			const feed = await fetch(`${RELEASES}/latest/download/latest.yml`, { signal: AbortSignal.timeout(30000) });
			const version = feed.ok ? (await feed.text()).match(/^version:\s*['"]?([\d.]+)/m)?.[1] : null;
			if (!version || !isLater(version, app.getVersion())) return send({ status: 'none', version: app.getVersion() });

			const download = await fetch(`${RELEASES}/download/v${version}/Catalog-${version}-mac.zip`);
			// Its Mac copy is built after the release goes out (about ten minutes): next time.
			if (download.status === 404) {
				log(`${version} is out; its Mac copy isn't ready yet`);
				return send({ status: 'none', version: app.getVersion() });
			}
			if (!download.ok || !download.body) throw new Error(`the download answered ${download.status}`);

			if (!canSwap()) log(`${version} found, but Catalog can't replace itself where it is (${runningBundle()})`);
			fs.rmSync(workDir(), { recursive: true, force: true });
			fs.mkdirSync(workDir(), { recursive: true });
			const zip = path.join(workDir(), 'Catalog.zip');
			const total = Number(download.headers.get('content-length')) || 0;
			const out = fs.createWriteStream(zip);
			let got = 0;
			let shown = -1;
			send({ status: 'downloading', version, percent: 0 });
			for await (const piece of download.body) {
				got += piece.length;
				if (!out.write(piece)) await new Promise((resolve) => out.once('drain', resolve));
				const percent = total ? Math.floor((got / total) * 100) : 0;
				if (percent !== shown) {
					shown = percent;
					send({ status: 'downloading', version, percent });
				}
			}
			await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));

			// ditto keeps everything a Mac app needs (its signature, links inside) as it was.
			await run('ditto', ['-x', '-k', zip, workDir()]);
			fs.rmSync(zip, { force: true });
			const bundle = path.join(workDir(), 'Catalog.app');
			const inside = (await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(bundle, 'Contents', 'Info.plist')])).trim();
			if (inside !== version) throw new Error(`the download is version ${inside}, not ${version}`);
			await run('xattr', ['-cr', bundle]).catch(() => {});

			ready = { version, bundle };
			log(`${version} downloaded and unpacked`);
			send({ status: 'ready', version });
		} catch (error) {
			log(`error: ${error?.message || error}`);
			send({ status: 'error', message: String(error?.message || error) });
		} finally {
			checking = false;
		}
	}

	/**
	 * Swaps the downloaded copy in for the running one and starts it. The running copy is only
	 * moved aside (deleted at the next start), so a swap that fails halfway is put back. False,
	 * with nothing changed, if it can't be done.
	 */
	function install({ restart = true } = {}) {
		if (!ready) return false;
		const current = runningBundle();
		if (!canSwap()) {
			log(`can't install: Catalog can't replace itself at ${current}`);
			send({ status: 'error', message: 'Catalog can’t update itself where it is. Move it to Applications, or download the new version.' });
			return false;
		}
		const aside = path.join(path.dirname(current), `.Catalog-old-${Date.now()}.app`);
		try {
			fs.renameSync(current, aside);
		} catch (error) {
			log(`can't move the running copy aside: ${error.message}`);
			send({ status: 'error', message: 'macOS didn’t let Catalog replace itself. Download the new version instead.' });
			return false;
		}
		try {
			try {
				fs.renameSync(ready.bundle, current);
			} catch (error) {
				// The download is on another disk than Applications: copied instead of moved.
				if (error.code !== 'EXDEV') throw error;
				require('node:child_process').execFileSync('ditto', [ready.bundle, current]);
			}
		} catch (error) {
			log(`can't put the new copy in place: ${error.message}`);
			fs.rmSync(current, { recursive: true, force: true });
			fs.renameSync(aside, current);
			send({ status: 'error', message: 'The update couldn’t be put in place. Download the new version instead.' });
			return false;
		}
		log(`installed ${ready.version} over ${app.getVersion()}${restart ? '; starting it' : ''}`);
		ready = null;
		if (restart) {
			app.relaunch({ execPath: path.join(current, 'Contents', 'MacOS', path.basename(process.execPath)) });
			app.quit();
		}
		return true;
	}

	return { check, install, tidy, isReady: () => Boolean(ready), canSwap };
}

module.exports = { createMacUpdater, isLater };
