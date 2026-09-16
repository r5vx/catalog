import { json, error } from '@sveltejs/kit';
import {
	updateMode,
	updateState,
	requestUpdateCheck,
	installUpdate,
	appVersion,
	sourceIsStale
} from '$lib/server/updater';
import { startRebuild, rebuildState } from '$lib/server/rebuild';
import { readSettings, updateSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

/** Where the Settings page polls while an update is running. */
export const GET: RequestHandler = async () => {
	const mode = updateMode();
	const state = updateState();
	const rebuild = rebuildState();

	/**
	 * Whether to offer an update unprompted.
	 *
	 * Only when there is genuinely one waiting, and only if you haven't asked
	 * to be left alone. A rebuild already running is not worth interrupting.
	 */
	const muted = Boolean(readSettings().updatePromptOff);
	const busy = rebuild.status === 'working' || rebuild.status === 'swapping';

	const offer =
		muted || busy
			? null
			: mode === 'release' && state.status === 'ready'
				? { kind: 'release' as const, version: state.version ?? null }
				: mode === 'source' && sourceIsStale()
					? { kind: 'source' as const, version: null }
					: null;

	return json({ mode, version: appVersion(), state, rebuild, offer, muted });
};

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

	// "Don't tell me again" — undone from Settings by updating once.
	if (action === 'mute') {
		updateSettings({ updatePromptOff: '1' });
		return json({ muted: true });
	}

	if (action === 'unmute') {
		updateSettings({ updatePromptOff: undefined });
		return json({ muted: false });
	}

	if (updateMode() !== 'source') {
		error(400, 'Updating is only available in the desktop app.');
	}

	startRebuild();
	return json({ started: true });
};
