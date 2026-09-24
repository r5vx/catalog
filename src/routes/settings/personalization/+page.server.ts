import { readSettings, updateSettings } from '$lib/server/settings';
import { DEFAULT_ACCENT, isHexColour } from '$lib/accent';
import { SORTS } from '$lib/constants';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

const VALID_THEMES = ['', 'light', 'dark', 'black'];

export const load: PageServerLoad = async () => {
	const settings = readSettings();

	return {
		accent: (() => {
			const saved = settings.accentColor ?? '';
			return isHexColour(saved) ? saved : DEFAULT_ACCENT;
		})(),
		hiddenSorts: (settings.hiddenSorts ?? '').split(',').filter(Boolean),
		theme: settings.theme ?? '',
		wideLayout: settings.wideLayout === '1',
		poisonMode: settings.poisonMode === '1'
	};
};

export const actions: Actions = {
	saveAccent: async ({ request }) => {
		const colour = String((await request.formData()).get('accentColor') ?? '').trim();

		if (!isHexColour(colour)) {
			return fail(400, { accentError: 'That is not a colour. Use the picker or a #rrggbb value.' });
		}

		updateSettings({ accentColor: colour.toLowerCase() });
		return { accentOk: 'Colour updated.' };
	},

	resetAccent: async () => {
		updateSettings({ accentColor: DEFAULT_ACCENT });
		return { accentOk: 'Back to the original colour.' };
	},

	saveTheme: async ({ request }) => {
		const theme = String((await request.formData()).get('theme') ?? '');
		if (!VALID_THEMES.includes(theme)) {
			return fail(400, { themeError: 'Unknown theme.' });
		}
		updateSettings({ theme: theme || undefined });
		return { themeOk: 'Theme updated.' };
	},

	/**
	 * Which sort options to offer.
	 *
	 * Stored as the ones you turned *off*, so a sort added in a later version
	 * shows up rather than being silently missing.
	 */
	saveLayout: async ({ request }) => {
		const form = await request.formData();
		const wide = form.get('wideLayout') === '1';
		updateSettings({ wideLayout: wide ? '1' : undefined });
		return { layoutOk: wide ? 'Wide layout enabled.' : 'Centered layout restored.' };
	},

	savePoison: async ({ request }) => {
		const on = String((await request.formData()).get('poisonMode')) === '1';
		updateSettings({ poisonMode: on ? '1' : undefined });
		return { poisonOk: on ? 'giblet mode activated' : 'Back to normal.' };
	},

	saveSorts: async ({ request }) => {
		const form = await request.formData();
		const keep = new Set(form.getAll('sort').map(String));

		const hidden = SORTS.map((one) => one.value).filter((value) => !keep.has(value));

		if (hidden.length === SORTS.length) {
			return fail(400, { sortError: 'Keep at least one way of sorting.' });
		}

		updateSettings({ hiddenSorts: hidden.join(',') || undefined });
		return { sortOk: 'Sorting updated.' };
	}
};
