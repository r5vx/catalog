import { json, error } from '@sveltejs/kit';
import { spawn } from 'node:child_process';
import {
	updaterPath,
	projectRoot,
	updateMode,
	updateState,
	requestUpdateCheck,
	installUpdate,
	appVersion
} from '$lib/server/updater';
import type { RequestHandler } from './$types';

/** Where the Settings page polls while an update is running. */
export const GET: RequestHandler = async () =>
	json({ mode: updateMode(), version: appVersion(), state: updateState() });

/**
 * Two kinds of update, picked by `?action=`.
 *
 * `check` and `install` belong to an installed copy: only the Electron process
 * can talk to GitHub Releases, so both are passed along to it and the answer
 * comes back on the same channel.
 *
 * The default is the rebuild, for a copy running from the project folder.
 * Windows won't let anything overwrite Catalog.exe while it's running, so the
 * helper is launched detached, waits for this app to close, rebuilds, and
 * starts it again. That's why the app shuts itself down a moment later.
 */
export const POST: RequestHandler = async ({ url }) => {
	const action = url.searchParams.get('action') ?? 'rebuild';

	if (action === 'check') {
		if (!requestUpdateCheck()) error(400, 'Updating is only available in the desktop app.');
		return json({ started: true });
	}

	if (action === 'install') {
		if (!installUpdate()) error(400, 'Updating is only available in the desktop app.');
		return json({ started: true });
	}

	const script = updaterPath();
	if (!script) error(400, 'Updating is only available in the desktop app.');

	const child = spawn('cmd.exe', ['/c', 'start', 'Updating Catalog', '/wait', script], {
		cwd: projectRoot(),
		detached: true,
		stdio: 'ignore',
		windowsHide: false
	});
	child.unref();

	// Give the browser a moment to show "updating" before the window closes.
	setTimeout(() => process.send?.({ type: 'quit-for-update' }), 1200);

	return json({ started: true });
};
