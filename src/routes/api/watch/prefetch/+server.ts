import { json } from '@sveltejs/kit';
import { prefetchStreamUrls } from '$lib/server/showbox';
import { readSettings } from '$lib/server/settings';
import type { RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request }) => {
	const { share_key, fids } = await request.json();
	if (!share_key || !Array.isArray(fids) || fids.length === 0) return json({ ok: false });
	// Only Showbox links are worth fetching ahead.
	if (String(share_key).includes(':')) return json({ ok: false });

	const { febboxToken } = readSettings();
	if (!febboxToken) return json({ ok: false });

	prefetchStreamUrls(share_key, fids.map(Number), febboxToken);
	return json({ ok: true });
};
