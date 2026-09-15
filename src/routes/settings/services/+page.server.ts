import { readSettings, updateSettings } from '$lib/server/settings';
import { verifyTmdbKey } from '$lib/server/metadata/tmdb';
import { verifyOmdbKey } from '$lib/server/metadata/omdb';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async () => {
	const settings = readSettings();

	// Never send the keys themselves to the browser — only whether one is saved.
	return {
		tmdbKeySaved: Boolean(settings.tmdbApiKey),
		omdbKeySaved: Boolean(settings.omdbApiKey)
	};
};

export const actions: Actions = {
	saveTmdb: async ({ request }) => {
		const key = String((await request.formData()).get('tmdbApiKey') ?? '').trim();

		if (!key) return fail(400, { tmdbError: 'Paste your key first.' });

		const check = await verifyTmdbKey(key);
		if (!check.ok) return fail(400, { tmdbError: check.message });

		updateSettings({ tmdbApiKey: key });
		return { tmdbOk: check.message };
	},

	removeTmdb: async () => {
		updateSettings({ tmdbApiKey: undefined });
		return { tmdbOk: 'Key removed. Anime search still works.' };
	},

	saveOmdb: async ({ request }) => {
		const key = String((await request.formData()).get('omdbApiKey') ?? '').trim();

		if (!key) return fail(400, { omdbError: 'Paste your key first.' });

		const check = await verifyOmdbKey(key);
		if (!check.ok) return fail(400, { omdbError: check.message });

		updateSettings({ omdbApiKey: key });
		return { omdbOk: check.message };
	},

	removeOmdb: async () => {
		updateSettings({ omdbApiKey: undefined });
		return { omdbOk: 'Key removed. TMDB scores still show.' };
	}
};
