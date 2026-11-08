import { readSettings, updateSettings, type Settings } from '$lib/server/settings';
import { backgroundFrom, clampTo, isOwnPicture, DEFAULT_DIM, MAX_DIM, MAX_BLUR } from '$lib/background';
import { DEFAULT_ACCENT, isHexColour } from '$lib/accent';
import { readCustomTheme, CUSTOM_COLOURS } from '$lib/customTheme';
import { SORTS } from '$lib/constants';
import { fail } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import type { PageServerLoad, Actions } from './$types';

/** The code's fingerprint (Settings → Personalization → Code): the code itself isn't kept here. */
const CODE_PRINT = '2ebac9f3e63b470d9091c1a7c751d9cd4ff9397bda3a75d284f950bdf9f2ed4a';

const VALID_THEMES = ['', 'light', 'dark', 'black', 'custom'];

export const load: PageServerLoad = async () => {
	const settings = readSettings();

	return {
		accent: (() => {
			const saved = settings.accentColor ?? '';
			return isHexColour(saved) ? saved : DEFAULT_ACCENT;
		})(),
		hiddenSorts: (settings.hiddenSorts ?? '').split(',').filter(Boolean),
		theme: settings.theme ?? '',
		// The Custom theme's colours, and whether any were ever picked (none: it starts from the theme in use).
		customTheme: readCustomTheme(settings.customTheme),
		customSaved: Boolean(settings.customTheme),
		wideLayout: settings.wideLayout !== '0',
		sideNav: settings.sideNav !== '0',
		ratingStars: settings.ratingStars === '10' ? 10 : 5,
		altMode: settings.altMode === '1',
		background: backgroundFrom(settings)
	};
};

export const actions: Actions = {
	saveAccent: async ({ request }) => {
		const colour = String((await request.formData()).get('accentColor') ?? '').trim();

		if (!isHexColour(colour)) {
			return fail(400, { accentError: 'That is not a color. Use the picker or a #rrggbb value.' });
		}

		updateSettings({ accentColor: colour.toLowerCase() });
		return { accentOk: 'Color updated.' };
	},

	resetAccent: async () => {
		updateSettings({ accentColor: DEFAULT_ACCENT });
		return { accentOk: 'Back to the original color.' };
	},

	saveTheme: async ({ request }) => {
		const theme = String((await request.formData()).get('theme') ?? '');
		if (!VALID_THEMES.includes(theme)) {
			return fail(400, { themeError: 'Unknown theme.' });
		}
		updateSettings({ theme: theme || undefined });
		return { themeOk: 'Theme updated.' };
	},

	/** The Custom theme's colours: every one an exact #rrggbb, kept even while another theme is on. */
	saveCustomTheme: async ({ request }) => {
		const form = await request.formData();
		const colours: Record<string, string> = {};
		for (const { key } of CUSTOM_COLOURS) {
			const value = String(form.get(key) ?? '').trim();
			if (!isHexColour(value)) return fail(400, { customError: 'Every color needs a #rrggbb code.' });
			colours[key] = value.toLowerCase();
		}
		updateSettings({ customTheme: JSON.stringify(colours), theme: 'custom' });
		return { customOk: true };
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

	saveRatingStars: async ({ request }) => {
		const ten = (await request.formData()).get('ratingStars') === '10';
		updateSettings({ ratingStars: ten ? '10' : '5' });
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

	/** The right code turns the alternate wording on; Turn off ends it. */
	saveCode: async ({ request }) => {
		const form = await request.formData();
		if (form.get('off') === '1') {
			updateSettings({ altMode: undefined });
			return { codeOk: true };
		}
		const code = String(form.get('code') ?? '').trim();
		const print = createHash('sha256').update(`catalog:${code}`).digest('hex');
		if (print !== CODE_PRINT) return fail(400, { codeError: 'That code does nothing.' });
		updateSettings({ altMode: '1' });
		return { codeOk: true };
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
