import { readSettings, updateSettings } from '$lib/server/settings';
import { verifyTmdbKey } from '$lib/server/metadata/tmdb';
import { verifyOmdbKey } from '$lib/server/metadata/omdb';
import { watchRegion, detectedRegion } from '$lib/server/metadata/providers';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async () => {
	const settings = readSettings();

	if (!settings.subdlSeen) updateSettings({ subdlSeen: '1' });

	return {
		tmdbKeySaved: Boolean(settings.tmdbApiKey),
		omdbKeySaved: Boolean(settings.omdbApiKey),
		febboxKeySaved: Boolean(settings.febboxToken),
		febboxToken: settings.febboxToken ?? '',
		subdlKeySaved: Boolean(settings.subdlApiKey),
		region: settings.watchRegion ?? '',
		regionInUse: watchRegion(),
		detectedRegion: detectedRegion()
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

	saveRegion: async ({ request }) => {
		const value = String((await request.formData()).get('watchRegion') ?? '')
			.trim()
			.toUpperCase();

		if (value && !/^[A-Z]{2}$/.test(value)) {
			return fail(400, { regionError: 'That is not a country code.' });
		}

		updateSettings({ watchRegion: value || undefined });
		return { regionOk: true };
	},

	saveFebbox: async ({ request }) => {
		const key = String((await request.formData()).get('febboxKey') ?? '').trim();
		if (!key) return fail(400, { febboxError: 'Paste a key first.' });

		updateSettings({ febboxToken: key });
		return { febboxOk: 'Key saved.' };
	},

	removeFebbox: async () => {
		updateSettings({ febboxToken: undefined });
		return { febboxOk: 'Key removed.' };
	},

	saveSubdl: async ({ request }) => {
		const key = String((await request.formData()).get('subdlApiKey') ?? '').trim();
		if (!key) return fail(400, { subdlError: 'Paste your key first.' });

		updateSettings({ subdlApiKey: key });
		return { subdlOk: 'Key saved. Subtitle search will now include SubDL results.' };
	},

	removeSubdl: async () => {
		updateSettings({ subdlApiKey: undefined });
		return { subdlOk: 'Key removed. Subtitles will still come from OpenSubtitles.' };
	}
};
