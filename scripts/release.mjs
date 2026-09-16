/**
 * Ships a new version to your friends.
 *
 * What it does, in order:
 *   1. bumps the version number in package.json
 *   2. builds the web app, then the desktop app, into `dist-release`
 *   3. puts the icon on it and wraps it in an installer
 *   4. commits, tags, and pushes
 *   5. uploads the installer to GitHub Releases
 *
 * It builds into its own folder rather than `dist-app`, so **you don't have to
 * close Catalog to make a release**. The copy you use day to day is untouched.
 *
 * The installer is always built with `--publish never` and uploaded separately,
 * for one reason: electron-builder's own publisher writes `latest.yml` only as
 * it uploads, so a failed upload leaves you with an installer and no way to
 * publish it by hand. Built this way, both files are always on disk.
 *
 * Uploading needs a GitHub token in `.env` as GH_TOKEN. Without one everything
 * is still built and the script tells you which two files to upload.
 *
 *   npm run release              1.0.0 -> 1.0.1
 *   npm run release -- minor     1.0.0 -> 1.1.0
 *   npm run release -- major     1.0.0 -> 2.0.0
 *   npm run release -- 1.4.2     exactly that
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageFile = join(root, 'package.json');

/** Kept apart from dist-app so a running Catalog.exe never blocks a release. */
const OUT = 'dist-release';
const UNPACKED = `${OUT}/win-unpacked`;

/** npm and npx are .cmd files on Windows, so they need a shell to start. */
const run = (command, args) =>
	spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: true });

/**
 * git, without a shell.
 *
 * With `shell: true` the arguments are concatenated rather than quoted, so
 * `commit -m Release 1.0.1` reached git as three words and it read the version
 * as a file path — the commit failed while the release carried on regardless.
 */
const git = (...args) => spawnSync('git', args, { cwd: root, stdio: 'inherit' });

const stop = (message) => {
	console.error(`\n${message}\n`);
	process.exit(1);
};

/* ------------------------------------------------------------- the version */

const manifest = JSON.parse(readFileSync(packageFile, 'utf8'));
const [major, minor, patch] = manifest.version.split('.').map(Number);
const previous = manifest.version;

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

const writeVersion = (value) => {
	manifest.version = value;
	writeFileSync(packageFile, JSON.stringify(manifest, null, '\t') + '\n', 'utf8');
};

console.log(`\n— Releasing ${previous} -> ${next} —\n`);
writeVersion(next);

/** Put the version back, so a failed build leaves nothing half-done. */
const abort = (message) => {
	writeVersion(previous);
	stop(message);
};

/* -------------------------------------------------------------- the build */

/**
 * Clear out the last release's files first.
 *
 * They are named per version, so they don't overwrite each other — and an
 * older installer sitting in the folder was picked up and published under the
 * new version's tag, with a latest.yml pointing at a file that wasn't there.
 */
if (existsSync(join(root, OUT))) {
	for (const name of readdirSync(join(root, OUT))) {
		if (/^Catalog-Setup-.*\.exe(\.blockmap)?$/.test(name) || name === 'latest.yml') {
			rmSync(join(root, OUT, name));
		}
	}
}

console.log('— Building the web app —');
if (run('npm', ['run', 'build']).status !== 0) {
	abort('The web build failed, so the version was put back. Nothing was released.');
}

console.log('\n— Packaging the desktop app —');
run('npx', ['electron-builder', '--win', 'dir', `-c.directories.output=${OUT}`]);

if (!existsSync(join(root, UNPACKED, 'Catalog.exe'))) {
	abort('No app was produced. See the errors above.');
}

// Before the installer, not after: an installer made from an un-iconed folder
// installs an un-iconed app, and electron-builder's own icon step doesn't run
// on this machine.
console.log('\n— Setting the app icon —');
if (run('node', ['scripts/set-exe-icon.mjs', UNPACKED]).status !== 0) {
	abort('Could not set the icon.');
}

/**
 * Write the file that tells an installed Catalog where to look for updates.
 *
 * electron-builder normally injects this while packaging, but we package with
 * `--win dir` and then wrap with `--prepackaged`, which skips that phase — so
 * it never appeared, and every installed copy failed its update check with
 * "ENOENT: app-update.yml". Writing it here keeps the icon fix, which needs
 * --prepackaged, without losing the updater.
 */
const publish = manifest.build.publish[0];

writeFileSync(
	join(root, UNPACKED, 'resources', 'app-update.yml'),
	[
		`provider: ${publish.provider}`,
		`owner: ${publish.owner}`,
		`repo: ${publish.repo}`,
		`updaterCacheDirName: ${manifest.name}-updater`,
		''
	].join('\n'),
	'utf8'
);

console.log('\n— Building the installer —');
run('npx', [
	'electron-builder',
	'--win',
	'nsis',
	'--prepackaged',
	UNPACKED,
	`-c.directories.output=${OUT}`,
	'--publish',
	'never'
]);

const outDir = join(root, OUT);

// By exact name, not "the first exe in the folder".
const installerName = `Catalog-Setup-${next}.exe`;
if (!existsSync(join(outDir, installerName))) {
	abort(`No installer was produced at ${OUT}/${installerName}. See the errors above.`);
}

const manifestName = 'latest.yml';
if (!existsSync(join(outDir, manifestName))) {
	abort(
		`The installer was built but ${manifestName} was not.\n` +
			'  Without it nobody gets the update. See the errors above.'
	);
}

/**
 * The blockmap lets an update download only the parts that changed, instead
 * of the whole 92 MB installer. It needs to be present for both the installed
 * version and the new one, so it only starts paying off once two releases in
 * a row have carried it.
 */
const blockmapName = `${installerName}.blockmap`;

const artefacts = [join(outDir, installerName), join(outDir, manifestName)];
if (existsSync(join(outDir, blockmapName))) artefacts.push(join(outDir, blockmapName));

/* ----------------------------------------------------------------- the notes */

const notesFile = join(root, 'RELEASE_NOTES.md');

/**
 * Takes the bullets from under "## Unreleased", and stamps that heading with
 * the version being shipped.
 *
 * The app shows these on its Updates page, so they're written for whoever is
 * using it rather than whoever wrote it. An empty section is a mistake worth
 * stopping for — a release nobody can read the changes of is half a release.
 */
function takeNotes() {
	if (!existsSync(notesFile)) return '';

	const text = readFileSync(notesFile, 'utf8');
	const match = /^## Unreleased\s*$([\s\S]*?)(?=^## |\Z)/m.exec(text);

	const body = (match?.[1] ?? '').trim();
	if (!body) return '';

	const today = new Date().toISOString().slice(0, 10);

	writeFileSync(
		notesFile,
		text.replace(/^## Unreleased\s*$/m, `## Unreleased

## ${next} — ${today}
`),
		'utf8'
	);

	return body;
}

const notes = takeNotes();

if (!notes) {
	abort(
		'There is nothing under "## Unreleased" in RELEASE_NOTES.md.\n' +
			'  Write a couple of bullets about what changed, then run this again.'
	);
}

console.log('\nWhat this release says:\n');
console.log(notes.replace(/^/gm, '  '));

/* --------------------------------------------------------------- the commit */

// Before the release is created, so the tag it points at already exists.
if (existsSync(join(root, '.git'))) {
	git('add', '-A');

	// Nothing staged is fine — the changes may already have been committed.
	if (spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: root }).status !== 0) {
		if (git('commit', '-m', `Release ${next}`).status !== 0) {
			abort('Could not commit the version bump. Nothing was released.');
		}
	}

	// Annotated, so `push --follow-tags` actually carries it.
	git('tag', '-a', `v${next}`, '-m', `Catalog ${next}`);

	if (git('push', '--follow-tags').status !== 0) {
		console.log('\n(The push failed. Push when you can — the build itself is fine.)');
	}
} else {
	console.log('\n(Not a git repository yet, so nothing was committed.)');
}

/* ---------------------------------------------------------------- the upload */

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
const { owner, repo } = manifest.build.publish[0];
const tag = `v${next}`;

/** What GitHub says when a token is missing the one permission that matters. */
function explain(status, body) {
	if (status === 403 && /not accessible by personal access token/i.test(body)) {
		return (
			'Your GH_TOKEN is missing permission to publish.\n' +
			'  Open https://github.com/settings/tokens?type=beta, edit the token, and set\n' +
			`    Repository access : Only select repositories -> ${repo}\n` +
			'    Permissions       : Repository permissions -> Contents -> Read and write\n' +
			'  Save it, then run this again.'
		);
	}

	if (status === 401) return 'GitHub rejected the token. It may have expired — make a new one.';
	if (status === 404) {
		return `GitHub can't see github.com/${owner}/${repo}. Check the repo exists and the token can reach it.`;
	}

	return `GitHub said ${status}: ${body.slice(0, 300)}`;
}

async function upload() {
	const api = (path, init = {}) =>
		fetch(`https://api.github.com${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				...init.headers
			}
		});

	// Reuse the release if this version has been attempted before, so a failed
	// upload can simply be run again.
	let release;
	const found = await api(`/repos/${owner}/${repo}/releases/tags/${tag}`);

	if (found.ok) {
		release = await found.json();
	} else {
		const created = await api(`/repos/${owner}/${repo}/releases`, {
			method: 'POST',
			body: JSON.stringify({
				tag_name: tag,
				name: `Catalog ${next}`,
				body: `${notes}

---

Download **Catalog-Setup-${next}.exe** below. Copies already installed update themselves.`
			})
		});

		if (!created.ok) throw new Error(explain(created.status, await created.text()));
		release = await created.json();
	}

	// A release holds exactly this version's files. Anything else in there is
	// left over from a failed attempt and would only confuse an updater.
	const keeping = new Set(artefacts.map((file) => basename(file)));
	for (const asset of release.assets ?? []) {
		if (!keeping.has(asset.name)) {
			console.log(`  removing stale ${asset.name}`);
			await api(`/repos/${owner}/${repo}/releases/assets/${asset.id}`, { method: 'DELETE' });
		}
	}

	for (const file of artefacts) {
		const name = basename(file);
		const body = readFileSync(file);

		// Replace rather than fail when a half-finished attempt left one behind.
		const clash = (release.assets ?? []).find((asset) => asset.name === name);
		if (clash) await api(`/repos/${owner}/${repo}/releases/assets/${clash.id}`, { method: 'DELETE' });

		process.stdout.write(`  uploading ${name} (${(body.length / 1048576).toFixed(1)} MB)… `);

		const sent = await fetch(
			`https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/octet-stream',
					'Content-Length': String(body.length)
				},
				body
			}
		);

		if (!sent.ok) {
			console.log('failed');
			throw new Error(explain(sent.status, await sent.text()));
		}

		console.log('done');
	}

	return release.html_url;
}

console.log(`\n${'-'.repeat(52)}`);

if (!token) {
	console.log(`\nBuilt ${next}, but nothing was uploaded — there's no GH_TOKEN in .env.`);
	console.log(`\nTo publish it by hand, make a release tagged ${tag} at`);
	console.log(`  https://github.com/${owner}/${repo}/releases/new`);
	console.log(`and attach BOTH of these from the ${OUT} folder:`);
	console.log(`  ${installerName}`);
	console.log(`  ${manifestName}`);
	console.log('\nThe .yml is what tells an installed Catalog that a new version exists.');
	process.exit(0);
}

console.log(`\n— Publishing ${tag} —`);

try {
	const url = await upload();
	console.log(`\nReleased ${next}. Everyone gets it the next time they open Catalog.`);
	console.log(`\n  ${url}\n`);
} catch (error) {
	console.error(`\n${error.message}`);
	console.error(
		`\nThe build is fine and still on disk — rerun \`npm run release -- ${next}\` once that's sorted,\n` +
			`or upload ${installerName} and ${manifestName} from ${OUT} by hand.\n`
	);
	process.exit(1);
}
