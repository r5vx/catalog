import { json } from '@sveltejs/kit';
import { updateSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

/** The TV app's layout: the TV one (rows for the remote) or the normal one. Body: { layout: 'tv' | 'full' }. */
export const POST: RequestHandler = async ({ request }) => {
	const { layout } = await request.json().catch(() => ({ layout: '' }));
	updateSettings({ tvLayout: layout === 'full' ? 'full' : '' });
	return json({ ok: true });
};
