import { json } from '@sveltejs/kit';
import { electronSyncCookies } from '$lib/server/electron-fetch';
import { updateSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
	const result = await electronSyncCookies();

	if (result.error || !result.token) {
		return json({ ok: false, error: result.error || 'no cookies' });
	}

	updateSettings({ febboxToken: result.token });
	return json({ ok: true });
};
