import { json } from '@sveltejs/kit';
import { noteStorage } from '$lib/server/storageHealth';
import type { RequestHandler } from './$types';

/** A page saying whether this browser kept its localStorage since its last start (storageHealth.ts). */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { since?: number | null; works?: boolean } | null;
	noteStorage(request.headers.get('user-agent') ?? '', Number(body?.since) || 0, body?.works !== false);
	return json({ ok: true });
};
