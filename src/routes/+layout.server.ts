import { readSettings } from '$lib/server/settings';
import { DEFAULT_ACCENT, isHexColour } from '$lib/accent';
import type { LayoutServerLoad } from './$types';

/** Every page needs the accent colour, so it's loaded once here. */
export const load: LayoutServerLoad = async () => {
	const saved = readSettings().accentColor ?? '';
	return { accent: isHexColour(saved) ? saved : DEFAULT_ACCENT };
};
