import { readSettings } from '$lib/server/settings';
import { DEFAULT_ACCENT, isHexColour } from '$lib/accent';
import { warmBrowseCache } from '$lib/server/metadata';
import type { LayoutServerLoad } from './$types';

let browseWarmed = false;

/** The accent colour and the sort list are wanted app-wide, so they load once. */
export const load: LayoutServerLoad = async () => {
	const settings = readSettings();
	const saved = settings.accentColor ?? '';

	if (!browseWarmed) {
		browseWarmed = true;
		warmBrowseCache();
	}

	return {
		accent: isHexColour(saved) ? saved : DEFAULT_ACCENT,
		hiddenSorts: (settings.hiddenSorts ?? '').split(',').filter(Boolean),
		theme: settings.theme ?? '',
		wideLayout: settings.wideLayout === '1',
		poisonMode: settings.poisonMode === '1'
	};
};
