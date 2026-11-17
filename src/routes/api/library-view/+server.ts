import { json, error } from '@sveltejs/kit';
import { saveView } from '$lib/server/libraryView';
import type { RequestHandler } from './$types';

/** The library's view, remembered (src/routes/+page.server.ts, keptView). */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (typeof body?.view !== 'string') return error(400, 'Missing view');
	// The sort for good, the filters for as long as Catalog is open (libraryView.ts).
	saveView(new URLSearchParams(body.view));
	return json({ ok: true });
};
