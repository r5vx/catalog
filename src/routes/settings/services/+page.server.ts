import { readSettings, updateSettings } from '$lib/server/settings';
import { verifyTmdbKey } from '$lib/server/metadata/tmdb';
import { verifyOmdbKey } from '$lib/server/metadata/omdb';
import { watchRegion } from '$lib/server/metadata/providers';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async () => {
	const settings = readSettings();

	// Never send the keys themselves to the browser — only whether one is saved.
	return {
		tmdbKeySaved: Boolean(settings.tmdbApiKey),
		omdbKeySaved: Boolean(settings.omdbApiKey),
		/** Blank when it's following this PC rather than a country you picked. */
		region: settings.watchRegion ?? '',
		/** What it's using either way, so the page can say so. */
		regionInUse: watchRegion()
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
	},

	/**
	 * Which country "where to watch" answers for. Blank follows this PC, which
	 * is right until you're using someone else's, or travelling.
	 */
	saveRegion: async ({ request }) => {
		const value = String((await request.formData()).get('watchRegion') ?? '')
			.trim()
			.toUpperCase();

		if (value && !/^[A-Z]{2}$/.test(value)) {
			return fail(400, { regionError: 'That is not a country code.' });
		}

		updateSettings({ watchRegion: value || undefined });
		return { regionOk: true };
	}
};
