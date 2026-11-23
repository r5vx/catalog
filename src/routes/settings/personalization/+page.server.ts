import { readSettings, updateSettings, type Settings } from '$lib/server/settings';
import { backgroundFrom, clampTo, isOwnPicture, DEFAULT_DIM, MAX_DIM, MAX_BLUR } from '$lib/background';
import { DEFAULT_ACCENT, isHexColour } from '$lib/accent';
import { readCustomTheme, CUSTOM_COLOURS } from '$lib/customTheme';
import { SORTS } from '$lib/constants';
import { appIconFrom, logoFrom, LOGO_WORDS_MOST, type AppIconChoice } from '$lib/logo';
import { inDesktopApp, saveAppIcon } from '$lib/server/appIcon';
import { fail } from '@sveltejs/kit';
import { fitFrom, isDefaultFit } from '$lib/pictureFit';
import { createHash } from 'node:crypto';
import type { PageServerLoad, Actions } from './$types';

/** The code's fingerprint (Settings → Personalization → Code): the code itself isn't kept here. */
const CODE_PRINT = '2ebac9f3e63b470d9091c1a7c751d9cd4ff9397bda3a75d284f950bdf9f2ed4a';

const VALID_THEMES = ['', 'light', 'dark', 'black', 'custom'];

export const load: PageServerLoad = async () => {
	const settings = readSettings();

	return {
		openOn: settings.openOn ?? 'new',
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
		background: backgroundFrom(settings),
		logo: logoFrom(settings),
		appIcon: appIconFrom(settings.appIcon),
		// The app icon is the desktop app's (its windows and shortcuts): only offered there.
		desktopApp: inDesktopApp()
	};
};

/** A PNG sent as a data address, as the page draws the app icon. At most 2 MB. */
function pngFrom(address: string): Buffer | null {
	const m = address.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
	if (!m) return null;
	const png = Buffer.from(m[1], 'base64');
	const signature = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
	return signature && png.length < 2 * 1024 * 1024 ? png : null;
}

export const actions: Actions = {
	saveOpenOn: async ({ request }) => {
		const openOn = String((await request.formData()).get('openOn') ?? '');
		if (openOn !== 'new' && openOn !== 'library') return fail(400, { openOnError: 'Choose Home or Library.' });
		updateSettings({ openOn });
	},
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
		if (form.has('fit')) {
			const fit = fitFrom(String(form.get('fit')));
			patch.backgroundFit = isDefaultFit(fit) ? undefined : JSON.stringify(fit);
		}
		updateSettings(patch);
		return { backgroundOk: true };
	},

	/** The logo: Catalog's own, words, or a picture (an address /api/media handed back), and its dot's color. */
	saveLogo: async ({ request }) => {
		const form = await request.formData();
		const kind = String(form.get('kind') ?? '');
		const words = String(form.get('words') ?? '').trim().slice(0, LOGO_WORDS_MOST);
		const image = String(form.get('image') ?? '');
		const dot = String(form.get('dot') ?? '').trim().toLowerCase();
		if (kind === 'words' && !words) return fail(400, { logoError: 'Type the words first.' });
		if (kind === 'picture' && !isOwnPicture(image)) return fail(400, { logoError: 'That picture could not be used.' });
		if (dot && !isHexColour(dot)) return fail(400, { logoError: 'That is not a color.' });
		updateSettings({
			logoKind: kind === 'words' || kind === 'picture' ? kind : undefined,
			logoWords: words || undefined,
			logoImage: isOwnPicture(image) ? image : undefined,
			logoDot: dot || undefined,
			// (Kept only when moved or resized: src/lib/logo.ts keeps them in bounds.)
			logoSize: form.has('size') && Number(form.get('size')) !== 100 ? String(Math.round(Number(form.get('size')) || 100)) : undefined,
			logoX: form.has('x') && Number(form.get('x')) ? String(Math.round(Number(form.get('x')))) : undefined,
			logoY: form.has('y') && Number(form.get('y')) ? String(Math.round(Number(form.get('y')))) : undefined
		});
		return { logoOk: true };
	},

	/** The app icon: what was picked, and the picture the page drew from it (none for the pink circle). */
	saveAppIcon: async ({ request }) => {
		const form = await request.formData();
		const kind = String(form.get('kind') ?? 'pink');
		if (kind === 'pink') {
			updateSettings({ appIcon: undefined });
			saveAppIcon(null);
			return { iconOk: true };
		}
		const png = pngFrom(String(form.get('png') ?? ''));
		if (!png) return fail(400, { iconError: 'That icon could not be made.' });
		const choice: AppIconChoice = appIconFrom(
			JSON.stringify({ kind, color: String(form.get('color') ?? ''), image: String(form.get('image') ?? ''), round: form.get('round') !== '0', fit: String(form.get('fit') ?? '') })
		);
		updateSettings({ appIcon: JSON.stringify(choice) });
		saveAppIcon(png);
		return { iconOk: true };
	},

	removeBackground: async () => {
		updateSettings({ backgroundImage: undefined, backgroundDim: undefined, backgroundBlur: undefined, backgroundFit: undefined });
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
