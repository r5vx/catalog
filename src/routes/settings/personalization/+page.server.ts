import { readSettings, updateSettings } from '$lib/server/settings';
import { DEFAULT_ACCENT, isHexColour } from '$lib/accent';
import { SORTS } from '$lib/constants';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async () => {
	const settings = readSettings();

	return {
		accent: (() => {
			const saved = settings.accentColor ?? '';
			return isHexColour(saved) ? saved : DEFAULT_ACCENT;
		})(),
		hiddenSorts: (settings.hiddenSorts ?? '').split(',').filter(Boolean)
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

	/**
	 * Which sort options to offer.
	 *
	 * Stored as the ones you turned *off*, so a sort added in a later version
	 * shows up rather than being silently missing.
	 */
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
