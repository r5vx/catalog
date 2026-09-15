import { readSettings, updateSettings, setPin, pinIsSet } from '$lib/server/settings';
import { verifyTmdbKey } from '$lib/server/metadata/tmdb';
import { listCategories } from '$lib/server/db/queries';
import { dbPath, dataDir } from '$lib/server/db';
import { updateMode, appVersion } from '$lib/server/updater';
import { DEFAULT_ACCENT, isHexColour } from '$lib/accent';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async () => ({
	// Never send the key itself to the browser — only whether one is saved.
	tmdbKeySaved: Boolean(readSettings().tmdbApiKey),
	pinSet: pinIsSet(),
	dbPath,
	dataDir,
	// The export picker offers the same categories the library has.
	categories: listCategories(),
	// 'source' rebuilds in place, 'release' downloads from GitHub, 'none' is
	// `npm run dev`, which has no exe to replace.
	updateMode: updateMode(),
	appVersion: appVersion(),
	accent: (() => {
		const saved = readSettings().accentColor ?? '';
		return isHexColour(saved) ? saved : DEFAULT_ACCENT;
	})()
});

export const actions: Actions = {
	saveKey: async ({ request }) => {
		const key = String((await request.formData()).get('tmdbApiKey') ?? '').trim();

		if (!key) return fail(400, { keyError: 'Paste your key first.' });

		const check = await verifyTmdbKey(key);
		if (!check.ok) return fail(400, { keyError: check.message });

		updateSettings({ tmdbApiKey: key });
		return { keyOk: check.message };
	},

	removeKey: async () => {
		updateSettings({ tmdbApiKey: undefined });
		return { keyOk: 'Key removed. Anime search still works.' };
	},

	savePin: async ({ request }) => {
		const pin = String((await request.formData()).get('pin') ?? '').trim();

		if (pin.length < 4) return fail(400, { pinError: 'Use at least 4 characters.' });

		setPin(pin);
		return { pinOk: 'PIN set. You will be asked for it on other devices.' };
	},

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

	removePin: async ({ cookies }) => {
		setPin(null);
		// Attributes must match the ones the cookie was set with, or it won't clear.
		cookies.delete('catalog_auth', { path: '/', secure: false });
		return { pinOk: 'PIN removed.' };
	}
};
