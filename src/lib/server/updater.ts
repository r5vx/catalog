import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readSettings, updateSettings } from './settings';
import { watchedLately } from './db/queries';

/**
 * Catalog updates itself two different ways, and which one you get depends on
 * how you got the app.
 *
 *   source  — you have the project folder. Updating rebuilds it in place,
 *             which is what `Update Catalog.bat` does.
 *   release — you installed it from an installer. There is no source code
 *             here, so it downloads a new version from GitHub Releases.
 *
 * The desktop wrapper works out which and passes it in; `npm run dev` gets
 * neither, because there is nothing to replace.
 */
export type UpdateMode = 'source' | 'release' | 'none';

export function updateMode(): UpdateMode {
	if (process.env.CATALOG_UPDATE_MODE === 'release') return 'release';
	return updaterPath() ? 'source' : 'none';
}

/** The updater script, or null when there's nothing to rebuild. */
export function updaterPath(): string | null {
	const root = process.env.CATALOG_PROJECT;
	if (!root) return null;

	const script = join(root, 'Update Catalog.bat');
	return existsSync(script) ? script : null;
}

export const projectRoot = () => process.env.CATALOG_PROJECT ?? process.cwd();

export const appVersion = () => process.env.CATALOG_VERSION ?? '';

/* ------------------------------------------------- talking to the desktop app */

export type UpdateState = {
	status: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error';
	version?: string;
	percent?: number;
	message?: string;
};

/**
 * Only the Electron process can check for updates, and only this process can
 * answer the browser — so the two talk over the channel that's already open
 * between them and the latest state is parked here in between.
 */
let state: UpdateState = { status: 'idle' };

export const updateState = (): UpdateState => state;

/** A version that was installed last time but didn't take: Catalog is still the old one. */
let failed: string | null = null;
export const failedUpdate = () => failed;

export function requestUpdateCheck(): boolean {
	if (!process.send) return false;
	state = { status: 'checking' };
	process.send({ type: 'check-for-updates' });
	return true;
}

export function installUpdate(): boolean {
	if (!process.send) return false;
	process.send({ type: 'install-update' });
	return true;
}

/**
 * Moving from "all users" to just this Windows account, so updates install by themselves
 * (electron/moveInstall.cjs). How it's going, as the desktop app says.
 */
export type MoveState = { status: 'idle' | 'downloading' | 'closing' | 'error'; message?: string };
let move: MoveState = { status: 'idle' };
export const moveState = (): MoveState => move;

export function moveInstall(): boolean {
	if (!process.send) return false;
	move = { status: 'downloading' };
	process.send({ type: 'move-install' });
	return true;
}

/* ---------------------------------------------------------- installing at night */

/**
 * Installing by itself: on unless turned off in Settings → Updates (it used to be off unless
 * turned on, so mom's laptop — closed, serving the TV, never quit — kept an update waiting
 * until someone clicked Restart on it). The hour it prefers (4 AM when unset).
 */
export function nightUpdate(): { on: boolean; hour: number } {
	const settings = readSettings();
	const hour = Number(settings.nightUpdateHour ?? 4);
	return { on: settings.nightUpdate !== '0', hour: Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : 4 };
}

/** When the update waiting now finished downloading. */
let readyAt = 0;
/** Windows asks permission for each install here (Catalog installed for all users). */
export const installNeedsPermission = () => process.env.CATALOG_INSTALL_NEEDS_PERMISSION === '1';

/**
 * Looked at every five minutes, with an update downloaded: Catalog restarts to install it in
 * the chosen hour — or, once it has waited 6 hours (a computer asleep at night), at any hour —
 * as long as nothing has played for 30 minutes. Once a day at most, so one that won't install
 * doesn't restart it over and over. Windows only: the Mac copy has its own updater.
 */
function installWhenQuiet() {
	const { on, hour } = nightUpdate();
	if (!on || updateMode() !== 'release' || process.platform !== 'win32' || !process.send) return;
	const now = new Date();
	const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	if (readSettings().nightUpdateTried === today) return;
	const inTheHour = now.getHours() === hour;
	if (state.status !== 'ready') {
		// Nothing downloaded yet: asked once at the start of the hour, and looked at again later.
		if (inTheHour && state.status !== 'checking' && state.status !== 'downloading' && now.getMinutes() < 5) requestUpdateCheck();
		return;
	}
	const waitedLong = readyAt > 0 && Date.now() - readyAt > 6 * 60 * 60 * 1000;
	if (!inTheHour && !waitedLong) return;
	if (watchedLately(30)) return;
	updateSettings({ nightUpdateTried: today });
	process.send({ type: 'install-update', auto: true });
}

setInterval(installWhenQuiet, 5 * 60 * 1000).unref?.();

// Registered once, on first import. `hooks.server.ts` imports this file so it
// happens at boot rather than whenever someone opens Settings — otherwise the
// result of the check made at launch would arrive with nobody listening.
process.on('message', (message: unknown) => {
	const note = message as { type?: string; state?: UpdateState } | null;
	if (note?.type === 'update-state' && note.state) {
		if (note.state.status === 'ready' && state.status !== 'ready') readyAt = Date.now();
		state = note.state;
	}
	if (note?.type === 'update-failed') failed = (note as { version?: string }).version ?? null;
	if (note?.type === 'move-state') move = (note as { state: MoveState }).state;
});

/* --------------------------------------------------- is an update waiting? */

/**
 * Whether the project has changed since the running app was built.
 *
 * A source build has no version to compare — it is whatever was last packaged.
 * So "out of date" means the files it was built from are newer than the build,
 * which is exactly the case after Claude edits something.
 *
 * Walking the tree costs a few milliseconds, so the answer is held briefly
 * rather than recomputed on every poll.
 */
let staleAnswer: { at: number; stale: boolean } = { at: 0, stale: false };

const STALE_CACHE_MS = 15_000;

function newestUnder(dir: string, deadline: number): number {
	let newest = 0;

	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return 0;
	}

	for (const entry of entries) {
		if (Date.now() > deadline) break;
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

		const full = join(dir, entry.name);

		try {
			newest = Math.max(
				newest,
				entry.isDirectory() ? newestUnder(full, deadline) : statSync(full).mtimeMs
			);
		} catch {
			// Vanished mid-walk. Not worth caring about.
		}
	}

	return newest;
}

export function sourceIsStale(): boolean {
	if (updateMode() !== 'source') return false;

	if (Date.now() - staleAnswer.at < STALE_CACHE_MS) return staleAnswer.stale;

	const root = projectRoot();

	let builtAt = 0;
	try {
		builtAt = statSync(join(root, 'dist-app', 'win-unpacked', 'resources', 'app.asar')).mtimeMs;
	} catch {
		return false;
	}

	// A second of slack, so a build that touches a file as it finishes doesn't
	// immediately declare itself out of date.
	const deadline = Date.now() + 1500;
	const newest = Math.max(
		newestUnder(join(root, 'src'), deadline),
		newestUnder(join(root, 'electron'), deadline),
		(() => {
			try {
				return statSync(join(root, 'package.json')).mtimeMs;
			} catch {
				return 0;
			}
		})()
	);

	const stale = newest > builtAt + 1000;
	staleAnswer = { at: Date.now(), stale };
	return stale;
}
