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
import { existsSync, renameSync, rmSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const live = join(root, 'dist-app', 'win-unpacked');
const staged = join(root, 'dist-staged', 'win-unpacked');
const previous = join(root, 'dist-app', 'win-unpacked.previous');

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

if (!existsSync(join(staged, 'Catalog.exe'))) {
	report('Nothing was staged, so nothing changed.');
	process.exit(1);
}

// Give it a minute. The app quits itself right after starting this.
for (let waited = 0; waited < 60 && locked(); waited++) await sleep(1000);

if (locked()) {
	report('Catalog was still running, so the update was left for next time.');
	process.exit(1);
}

// Windows sometimes holds the files for a moment after the process goes.
await sleep(600);

try {
	if (existsSync(previous)) rmSync(previous, { recursive: true, force: true });
	if (existsSync(live)) renameSync(live, previous);

	renameSync(staged, live);

	// Only once the new one is definitely in place.
	if (existsSync(previous)) rmSync(previous, { recursive: true, force: true });

	report('Updated.');
} catch (problem) {
	// Put the old one back rather than leaving nothing behind.
	if (!existsSync(live) && existsSync(previous)) {
		try {
			renameSync(previous, live);
		} catch {
			// Both moves failed; the paths in the note are the way back.
		}
	}

	report(`The swap failed: ${problem?.message ?? problem}`);
	process.exit(1);
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
