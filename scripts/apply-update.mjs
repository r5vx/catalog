/**
 * Swaps the freshly built Catalog in, once the old one has closed.
 *
 * This is the only part that needs the app shut, and it's a folder move rather
 * than a build — a second or two, with no window. Everything slow already
 * happened in `stage-update.mjs` while you were still using the app.
 *
 * The old folder is kept aside until the new one is in place, so a failure
 * halfway leaves you with a working app rather than half of one.
 */
import { spawn } from 'node:child_process';
import {
	existsSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
	openSync,
	closeSync
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const live = join(root, 'dist-app', 'win-unpacked');
const previous = join(root, 'dist-app', 'win-unpacked.previous');
const lock = join(root, 'dist-staged', 'applying.txt');

/**
 * Only one helper at a time.
 *
 * The app starts one when you press Update and another when it quits, and
 * those two raced: the first swapped successfully and relaunched the app, then
 * the second found the folder busy and overwrote "Updated." with an EPERM
 * failure. The update had worked; only the note said otherwise.
 *
 * The lock is a **heartbeat**, not a timestamp taken once. A helper spends most
 * of its life waiting, and the app needs to be able to tell "someone is on it"
 * from "someone died holding it" — the difference decides whether starting
 * Catalog should step aside or take the job over. So the time is rewritten
 * every second while waiting, and anything older than `LOCK_STALE_MS` is
 * nobody's.
 */
const LOCK_STALE_MS = 30_000;

const beat = () => {
	try {
		writeFileSync(lock, String(Date.now()), 'utf8');
		return true;
	} catch {
		return false;
	}
};

function claim() {
	try {
		const held = Number(readFileSync(lock, 'utf8'));
		if (Number.isFinite(held) && Date.now() - held < LOCK_STALE_MS) return false;
	} catch {
		// No lock, or an unreadable one. Ours now.
	}

	return beat();
}

const release = () => {
	try {
		rmSync(lock, { force: true });
	} catch {
		// It goes stale on its own within the half minute.
	}
};

/**
 * Every way out of here releases the lock.
 *
 * Leaving it behind is what turned one slow update into a broken one: the
 * helper gave up after five minutes without tidying up, and for the next ten
 * minutes every helper the app started exited on sight of that lock — while
 * the app quit each time believing one had gone to work.
 */
function give(text, code) {
	report(text);
	release();
	process.exit(code);
}

/**
 * Which build to install.
 *
 * Staging folders are named per run, so the server passes the one it just
 * made. The fallback — newest complete build under `dist-staged` — is what an
 * older Catalog does, since it predates the argument and would otherwise close
 * itself and never reopen.
 */
function findStaged() {
	const given = process.argv[2];
	if (given && existsSync(join(root, given, 'win-unpacked', 'Catalog.exe'))) {
		return join(root, given, 'win-unpacked');
	}

	const base = join(root, 'dist-staged');
	if (!existsSync(base)) return '';

	const builds = readdirSync(base)
		.map((name) => join(base, name, 'win-unpacked'))
		.filter((path) => existsSync(join(path, 'Catalog.exe')))
		.map((path) => ({ path, at: statSync(join(path, 'Catalog.exe')).mtimeMs }))
		.sort((a, b) => b.at - a.at);

	// The folder an older Catalog wrote to, before they were named per run.
	const legacy = join(base, 'win-unpacked');
	if (builds.length === 0 && existsSync(join(legacy, 'Catalog.exe'))) return legacy;

	return builds[0]?.path ?? '';
}

const staged = findStaged();

/** A note the app reads on next start, so a failure isn't silent. */
const report = (text) => {
	try {
		writeFileSync(join(root, 'dist-app', 'last-update.txt'), text, 'utf8');
	} catch {
		// Nothing we can do about it from here.
	}
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether the app we're replacing is still holding its own exe.
 *
 * Asking Windows for the lock rather than looking for the process name: the
 * lock is the thing that actually stops the swap, and the server is forked
 * with Electron's binary so it shows up under the same name anyway.
 */
function locked() {
	const exe = join(live, 'Catalog.exe');
	if (!existsSync(exe)) return false;

	try {
		// Opening for write fails while the file is running.
		closeSync(openSync(exe, 'r+'));
		return false;
	} catch {
		return true;
	}
}

if (!staged || !existsSync(join(staged, 'Catalog.exe'))) {
	// No lock was taken yet, so there is nothing to release.
	report('Nothing was staged, so nothing changed.');
	process.exit(1);
}

// Another helper is already on it; say nothing and let it finish.
if (!claim()) process.exit(0);

/**
 * Wait for the app to let go.
 *
 * Generous, because the common way this fails is someone reopening Catalog
 * while the swap is waiting — the window vanishes, they think it's finished or
 * broken, and click the icon again. Giving up would throw away a finished
 * build; the marker stays, so the next start applies it instead.
 *
 * The heartbeat is what makes waiting safe: starting Catalog can see that a
 * helper is genuinely on the job and step aside for it, rather than spawning a
 * rival that dies on the lock while the app quits for nothing.
 */
const WAIT_SECONDS = 600;

let waited = 0;
for (; waited < WAIT_SECONDS && locked(); waited++) {
	beat();
	await sleep(1000);
}

if (locked()) {
	give('Catalog stayed open, so the update is still waiting. Close it and open it again.', 1);
}

// Windows sometimes holds the files for a moment after the process goes.
await sleep(600);

/**
 * The rename can still fail if the app came back in the moment between the
 * lock check and the move — someone reopening it, or the previous helper
 * relaunching it. Worth a few goes before giving up on a finished build.
 */
async function moveAside() {
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			if (existsSync(previous)) rmSync(previous, { recursive: true, force: true });
			if (existsSync(live)) renameSync(live, previous);
			return true;
		} catch {
			await sleep(1500);
		}
	}
	return false;
}

try {
	if (!(await moveAside())) throw new Error('the old version is still in use');

	renameSync(staged, live);

	// Only once the new one is definitely in place.
	if (existsSync(previous)) rmSync(previous, { recursive: true, force: true });

	// Applied, so the app should stop being told there's one waiting.
	try {
		rmSync(join(root, 'dist-staged', 'pending.txt'), { force: true });
	} catch {
		// It will be overwritten by the next update anyway.
	}

	report('Updated.');
	release();
} catch (problem) {
	// Put the old one back rather than leaving nothing behind.
	if (!existsSync(live) && existsSync(previous)) {
		try {
			renameSync(previous, live);
		} catch {
			// Both moves failed; the paths in the note are the way back.
		}
	}

	give(`The swap failed: ${problem?.message ?? problem}`, 1);
}

/**
 * Reopen it.
 *
 * The update is already applied by this point, so a failure to relaunch is
 * worth a note and nothing more. Both a synchronous throw and an async error
 * event are possible, and the throw is the one that would otherwise take the
 * whole script down after a perfectly good swap.
 */
try {
	const started = spawn(join(live, 'Catalog.exe'), [], {
		detached: true,
		stdio: 'ignore',
		windowsHide: false
	});

	started.on('error', () => report('Updated, but Catalog could not be reopened.'));
	started.unref();
} catch {
	report('Updated, but Catalog could not be reopened. Open it from your desktop.');
}
