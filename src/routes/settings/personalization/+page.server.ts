import { readSettings, updateSettings, type Settings } from '$lib/server/settings';
import { backgroundFrom, clampTo, isOwnPicture, DEFAULT_DIM, MAX_DIM, MAX_BLUR } from '$lib/background';
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
		wideLayout: settings.wideLayout !== '0',
		sideNav: settings.sideNav !== '0',
		poisonMode: settings.poisonMode === '1',
		background: backgroundFrom(settings)
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
		updateSettings({ wideLayout: wide ? '1' : '0' });
		return { layoutOk: wide ? 'Wide layout enabled.' : 'Centered layout restored.' };
	},

	saveSideNav: async ({ request }) => {
		const on = (await request.formData()).get('sideNav') === '1';
		updateSettings({ sideNav: on ? '1' : '0' });
	},

	/** The background picture (an address /api/media handed back), and its Dim and Blur. */
	saveBackground: async ({ request }) => {
		const form = await request.formData();
		const patch: Partial<Settings> = {};
		const image = form.get('image');
		if (image !== null) {
			if (!isOwnPicture(String(image))) return fail(400, { backgroundError: 'That picture could not be used.' });
			patch.backgroundImage = String(image);
		}
		if (form.has('dim')) patch.backgroundDim = String(clampTo(form.get('dim'), MAX_DIM, DEFAULT_DIM));
		if (form.has('blur')) patch.backgroundBlur = String(clampTo(form.get('blur'), MAX_BLUR, 0));
		updateSettings(patch);
		return { backgroundOk: true };
	},

	removeBackground: async () => {
		updateSettings({ backgroundImage: undefined, backgroundDim: undefined, backgroundBlur: undefined });
		return { backgroundOk: true };
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
