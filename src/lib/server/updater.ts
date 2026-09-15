import { existsSync } from 'node:fs';
import { join } from 'node:path';

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

// Registered once, on first import. `hooks.server.ts` imports this file so it
// happens at boot rather than whenever someone opens Settings — otherwise the
// result of the check made at launch would arrive with nobody listening.
process.on('message', (message: unknown) => {
	const note = message as { type?: string; state?: UpdateState } | null;
	if (note?.type === 'update-state' && note.state) state = note.state;
});
