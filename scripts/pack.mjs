/**
 * Builds the desktop app.
 *
 * Wraps electron-builder because of one quirk on this machine: its
 * code-signing bundle contains macOS symlinks, Windows refuses to create them
 * without Developer Mode, and electron-builder calls that fatal — even though
 * it has already produced a perfectly good app folder. That non-zero exit also
 * meant the icon step never ran, which is why the app kept a fuzzy icon.
 *
 * So: run the build, judge it by whether the exe actually appeared, then set
 * the icon ourselves.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = join(root, 'dist-app', 'win-unpacked', 'Catalog.exe');

const run = (command, args) =>
	spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: true });

console.log('\n— Building the web app —');
if (run('npm', ['run', 'build']).status !== 0) {
	console.error('The web build failed. Stopping.');
	process.exit(1);
}

const before = existsSync(exe) ? statSync(exe).mtimeMs : 0;

console.log('\n— Packaging the desktop app —');
const builder = run('npx', ['electron-builder', '--win', 'dir']);

if (!existsSync(exe)) {
	console.error('\nNo app was produced. See the errors above.');
	process.exit(1);
}

if (statSync(exe).mtimeMs === before) {
	console.error('\nThe app was not rebuilt — is Catalog still open? Close it and try again.');
	process.exit(1);
}

if (builder.status !== 0) {
	console.log('\n(electron-builder reported errors, but the app was built. Carrying on.)');
}

console.log('\n— Setting the app icon —');
if (run('node', ['scripts/set-exe-icon.mjs']).status !== 0) {
	console.error('Could not set the icon.');
	process.exit(1);
}

console.log('\nDone. Open Catalog from your desktop shortcut.');
