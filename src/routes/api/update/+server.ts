import { json, error } from '@sveltejs/kit';
import {
	updateMode,
	updateState,
	requestUpdateCheck,
	installUpdate,
	appVersion
} from '$lib/server/updater';
import { startRebuild, rebuildState } from '$lib/server/rebuild';
import type { RequestHandler } from './$types';

/** Where the Settings page polls while an update is running. */
export const GET: RequestHandler = async () =>
	json({
		mode: updateMode(),
		version: appVersion(),
		state: updateState(),
		rebuild: rebuildState()
	});

/**
 * Two kinds of update, picked by `?action=`.
 *
 * `check` and `install` belong to an installed copy: only the Electron process
 * can talk to GitHub Releases, so both are passed along to it and the answer
 * comes back on the same channel.
 *
 * The default is the rebuild, for a copy running from the project folder.
 * It builds into a staging folder with the app still open, so the page can
 * show real progress. The app only closes for the final swap, which is a
 * folder move rather than a build.
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

	if (updateMode() !== 'source') {
		error(400, 'Updating is only available in the desktop app.');
	}

	startRebuild();
	return json({ started: true });
};
