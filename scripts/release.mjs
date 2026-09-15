/**
 * Ships a new version to your friends.
 *
 * What it does, in order:
 *   1. bumps the version number in package.json
 *   2. builds the app and sets its icon (`npm run pack`)
 *   3. wraps that folder in an installer
 *   4. commits, tags, and pushes
 *   5. uploads the installer to GitHub Releases
 *
 * Step 5 needs a GitHub token in `.env` as GH_TOKEN. Without one the installer
 * is still built and the script tells you where it is — you can upload it by
 * hand and everything still works.
 *
 *   npm run release              1.0.0 -> 1.0.1
 *   npm run release -- minor     1.0.0 -> 1.1.0
 *   npm run release -- major     1.0.0 -> 2.0.0
 *   npm run release -- 1.4.2     exactly that
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageFile = join(root, 'package.json');

const run = (command, args, env) =>
	spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, ...env } });

const quiet = (command, args) =>
	spawnSync(command, args, { cwd: root, encoding: 'utf8' }).stdout?.trim() ?? '';

const stop = (message) => {
	console.error(`\n${message}\n`);
	process.exit(1);
};

/* ------------------------------------------------------------- the version */

const manifest = JSON.parse(readFileSync(packageFile, 'utf8'));
const [major, minor, patch] = manifest.version.split('.').map(Number);

const asked = process.argv[2] ?? 'patch';

const next =
	asked === 'major'
		? `${major + 1}.0.0`
		: asked === 'minor'
			? `${major}.${minor + 1}.0`
			: asked === 'patch'
				? `${major}.${minor}.${patch + 1}`
				: asked;

if (!/^\d+\.\d+\.\d+$/.test(next)) {
	stop(`"${asked}" isn't a version. Use major, minor, patch, or something like 1.4.2.`);
}

console.log(`\n— Releasing ${manifest.version} -> ${next} —\n`);

manifest.version = next;
writeFileSync(packageFile, JSON.stringify(manifest, null, '\t') + '\n', 'utf8');

/* -------------------------------------------------------------- the build */

// `pack` builds the web app, packages it, and sets the icon — the icon has to
// go on before the installer is made, or the installed app gets the default.
if (run('npm', ['run', 'pack']).status !== 0) {
	manifest.version = `${major}.${minor}.${patch}`;
	writeFileSync(packageFile, JSON.stringify(manifest, null, '\t') + '\n', 'utf8');
	stop('The build failed, so the version was put back. Nothing was released.');
}

/* ---------------------------------------------------------- the credentials */

/** Reads GH_TOKEN out of .env without needing a package to do it. */
function tokenFromEnvFile() {
	const file = join(root, '.env');
	if (!existsSync(file)) return '';

	for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
		const match = /^\s*(?:GH_TOKEN|GITHUB_TOKEN)\s*=\s*(.+?)\s*$/.exec(line);
		if (match) return match[1].replace(/^["']|["']$/g, '');
	}
	return '';
}

const token = process.env.GH_TOKEN || tokenFromEnvFile();

/* ---------------------------------------------------------- the installer */

console.log('\n— Building the installer —');

const builder = run(
	'npx',
	[
		'electron-builder',
		'--win',
		'nsis',
		'--prepackaged',
		'dist-app/win-unpacked',
		'--publish',
		token ? 'always' : 'never'
	],
	token ? { GH_TOKEN: token } : {}
);

const installer = existsSync(join(root, 'dist-app'))
	? readdirSync(join(root, 'dist-app')).find((name) => name.endsWith('.exe'))
	: null;

if (!installer) stop('No installer was produced. See the errors above.');

if (builder.status !== 0 && token) {
	stop(
		`The installer was built but publishing failed.\n` +
			`  It's at dist-app\\${installer}\n` +
			`  Check that GH_TOKEN in .env is still valid.`
	);
}

/* --------------------------------------------------------------- the commit */

if (existsSync(join(root, '.git'))) {
	run('git', ['add', '-A']);
	run('git', ['commit', '-m', `Release ${next}`]);
	run('git', ['tag', `v${next}`]);

	const pushed = run('git', ['push', '--follow-tags']).status === 0;
	if (!pushed) console.log('\n(The push failed — the release itself is fine. Push when you can.)');
} else {
	console.log('\n(Not a git repository yet, so nothing was committed.)');
}

/* ------------------------------------------------------------------- done */

console.log(`\n${'-'.repeat(52)}`);

if (token) {
	console.log(`\nReleased ${next}.`);
	console.log('Everyone gets it the next time they open Catalog.');
} else {
	console.log(`\nBuilt ${next}, but nothing was uploaded — there's no GH_TOKEN in .env.`);
	console.log(`\nTo publish it by hand, make a release tagged v${next} at`);
	console.log(`  https://github.com/${manifest.build.publish[0].owner}/${manifest.build.publish[0].repo}/releases/new`);
	console.log('and attach BOTH of these from the dist-app folder:');
	console.log(`  ${installer}`);
	console.log('  latest.yml');
	console.log('\nThe .yml is what tells an installed Catalog that a new version exists.');
}

console.log('');
