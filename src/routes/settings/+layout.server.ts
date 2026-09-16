import { updateMode, appVersion, updateState, sourceIsStale } from '$lib/server/updater';
import { whatsNew } from '$lib/server/whatsnew';
import { readSettings } from '$lib/server/settings';
import { omdbConfigured } from '$lib/server/metadata/omdb';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
	const mode = updateMode();

	/**
	 * A dot beside a section that wants attention.
	 *
	 * Only for things that are genuinely worth acting on — a key that isn't
	 * set, or an update actually waiting — so it never becomes decoration.
	 */
	const needs = {
		services: !readSettings().tmdbApiKey || !omdbConfigured(),
		updates:
			(mode === 'release' && updateState().status === 'ready') ||
			(mode === 'source' && sourceIsStale())
	};

	return {
		updateMode: mode,
		appVersion: appVersion(),
		releases: whatsNew(),
		needs
	};
};
