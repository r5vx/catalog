import { readSettings } from '$lib/server/settings';
import { DEFAULT_ACCENT, isHexColour } from '$lib/accent';
import type { LayoutServerLoad } from './$types';

/** The accent colour and the sort list are wanted app-wide, so they load once. */
export const load: LayoutServerLoad = async () => {
	const settings = readSettings();
	const saved = settings.accentColor ?? '';

	return {
		accent: isHexColour(saved) ? saved : DEFAULT_ACCENT,
		hiddenSorts: (settings.hiddenSorts ?? '').split(',').filter(Boolean),
		theme: settings.theme ?? '',
		wideLayout: settings.wideLayout === '1'
	};
};
