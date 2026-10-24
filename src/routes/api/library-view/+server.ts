import { json, error } from '@sveltejs/kit';
import { updateSettings } from '$lib/server/settings';
import { KEPT_FILTERS } from '$lib/constants';
import type { RequestHandler } from './$types';

/** The library's filters, remembered for next time (src/routes/+page.server.ts, keptView). */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (typeof body?.view !== 'string') return error(400, 'Missing view');
	// Only the filters that are kept, nothing else.
	const given = new URLSearchParams(body.view);
	const view = new URLSearchParams();
	for (const key of KEPT_FILTERS) for (const value of given.getAll(key)) if (value) view.append(key, value);
	updateSettings({ libraryView: view.toString() });
	return json({ ok: true });
};
