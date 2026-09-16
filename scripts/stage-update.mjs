/**
 * Builds the new Catalog while the old one is still running.
 *
 * It builds into `dist-staged`, never `dist-app`, so nothing it touches is
 * locked by the app you're looking at. That's what lets the update show a
 * progress bar in the app instead of a console window: the slow part happens
 * with Catalog open, and only the final swap needs it closed.
 *
 * Progress is printed as `::step <n>/<total> <label>` lines, which the server
 * reads and the Settings page turns into a bar. Everything else the build
 * prints goes to stderr, where it stays out of the way unless something fails.
 */
import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Each build gets its own folder under `dist-staged`.
 *
 * Reusing one name meant clearing it first, and Windows sometimes holds a
 * freshly written `app.asar` for a long time with no process owning it — a
 * lock that outlived every build tool and every visible process by twenty
 * minutes. Nothing has to be deleted before a build now; old folders are
 * tidied up afterwards if they will go, and left alone if they will not.
 */
const STAGED = ['dist-staged', String(Date.now())].join('/');
const UNPACKED = join(root, STAGED, 'win-unpacked');

const STEPS = ['Fetching the latest code', 'Building', 'Packaging', 'Finishing up'];

let current = 0;

function step(label) {
	current += 1;
	// The one thing on stdout the server cares about.
	process.stdout.write(`::step ${current}/${STEPS.length} ${label}\n`);
}

function fail(message) {
	process.stdout.write(`::fail ${message}\n`);
	process.exit(1);
}

/** Runs a command, keeping its chatter on stderr where the bar won't see it. */
function run(command, args) {
	return new Promise((resolve) => {
		const child = spawn(command, args, { cwd: root, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });

		let tail = '';
		const keep = (chunk) => {
			tail = (tail + chunk).slice(-4000);
			process.stderr.write(chunk);
		};

		child.stdout.on('data', keep);
		child.stderr.on('data', keep);
		child.on('close', (code) => resolve({ code, tail }));
	});
}

/* ------------------------------------------------------------------ the work */

step(STEPS[0]);

/**
 * Pull, but only when there's nothing of your own to lose.
 *
 * Uncommitted changes in the folder *are* the update — that's the usual case
 * here — and pulling over them would either fail or fight them. A clean clone
 * with a remote is the only time fetching is the right move.
 */
if (existsSync(join(root, '.git'))) {
	const dirty = (await run('git', ['status', '--porcelain'])).tail.trim();
	const remotes = (await run('git', ['remote'])).tail.trim();

	if (dirty) {
		process.stderr.write('\n(Local changes present — building those rather than pulling.)\n');
	} else if (remotes) {
		const pulled = await run('git', ['pull', '--ff-only']);
		if (pulled.code !== 0) {
			process.stderr.write('\n(Could not pull. Building what is already here.)\n');
		}
	}
}

step(STEPS[1]);

const web = await run('npm', ['run', 'build']);
if (web.code !== 0) fail('The build failed. Nothing was changed.');

step(STEPS[2]);

// A folder of its own, so nothing has to be deleted before building.
mkdirSync(join(root, STAGED), { recursive: true });

await run('npx', ['electron-builder', '--win', 'dir', `-c.directories.output=${STAGED}`]);

if (!existsSync(join(UNPACKED, 'Catalog.exe'))) {
	fail('The app could not be packaged. Nothing was changed.');
}

step(STEPS[3]);

// electron-builder's own icon step doesn't run on this machine, so the icon
// goes on here — before the swap, or the installed app loses it.
await run('node', ['scripts/set-exe-icon.mjs', `${STAGED}/win-unpacked`]);

// Folders from previous updates, including any Windows is still holding on to.
// Whatever will not go is skipped rather than failing the update over it.
for (const name of readdirSync(join(root, 'dist-staged'))) {
	// Only past build folders. `pending.txt` and the helper's lock live here
	// too, and deleting those would throw away the update this is preparing.
	if (!/^\d+$/.test(name)) continue;
	if (`dist-staged/${name}` === STAGED) continue;

	try {
		rmSync(join(root, 'dist-staged', name), { recursive: true, force: true });
	} catch {
		// Still locked. It costs disk space and nothing else.
	}
}

/**
 * Which folder the swap should take, and what version is in it.
 *
 * The version matters at startup: the app compares it against its own to
 * decide whether a pending update is worth restarting for, which is what stops
 * a failed swap turning into a boot loop.
 */
let built = '';
try {
	built = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? '';
} catch {
	// Without it the update still applies; it just can't be compared.
}

process.stdout.write(`::staged ${STAGED} ${built}\n`);
process.stdout.write('::ready\n');
