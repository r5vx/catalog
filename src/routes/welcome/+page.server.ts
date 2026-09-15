import { markSetupDone, updateSettings } from '$lib/server/settings';
import { verifyTmdbKey } from '$lib/server/metadata/tmdb';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
	saveKey: async ({ request }) => {
		const key = String((await request.formData()).get('tmdbApiKey') ?? '').trim();

		if (!key) return fail(400, { keyError: 'Paste your key first.' });

		const check = await verifyTmdbKey(key);
		if (!check.ok) return fail(400, { keyError: check.message });

		updateSettings({ tmdbApiKey: key });
		markSetupDone();
		redirect(303, '/');
	},

	// Anime needs no key at all, so there's a real app on the other side of
	// this button. The key can be added from Settings whenever.
	skip: async () => {
		markSetupDone();
		redirect(303, '/');
	}
};
