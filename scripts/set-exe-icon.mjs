/**
 * Puts the app icon into Catalog.exe.
 *
 * electron-builder normally does this itself, but on this machine its
 * code-signing bundle fails to unpack (it contains macOS symlinks Windows
 * won't create without Developer Mode), and it treats that as fatal — so the
 * icon step never runs and the exe keeps Electron's default.
 *
 * The tool it would have used is sitting in that same cache, so we just run it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Which build to stamp. A release builds into its own folder so it never has
// to wait for a running Catalog.exe to be closed.
const unpacked = process.argv[2] ?? join('dist-app', 'win-unpacked');

const exe = join(root, unpacked, 'Catalog.exe');
const icon = join(root, 'assets', 'icon.ico');

if (!existsSync(exe)) {
	console.error(`No built app found at ${unpacked}. Run \`npm run pack\` first.`);
	process.exit(1);
}

function findRcedit() {
	const cache = join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache', 'winCodeSign');
	if (!existsSync(cache)) return null;

	for (const folder of readdirSync(cache)) {
		const candidate = join(cache, folder, 'rcedit-x64.exe');
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

const rcedit = findRcedit();

if (!rcedit) {
	console.error('Could not find rcedit. The exe will keep the default icon.');
	process.exit(0); // not worth failing the whole build over
}

execFileSync(rcedit, [exe, '--set-icon', icon], { stdio: 'inherit' });

// Confirm it actually landed, rather than assuming.
const ico = readFileSync(icon);
const binary = readFileSync(exe);
let embedded = 0;

for (let i = 0; i < ico.readUInt16LE(4); i++) {
	const at = 6 + i * 16;
	const offset = ico.readUInt32LE(at + 12);
	const length = ico.readUInt32LE(at + 8);
	if (binary.includes(ico.subarray(offset + 16, offset + Math.min(80, length)))) embedded++;
}

console.log(`Icon embedded: ${embedded}/${ico.readUInt16LE(4)} sizes`);
