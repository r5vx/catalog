import { json } from '@sveltejs/kit';
import { whatsNewSeen } from '$lib/server/whatsNewCard';
import type { RequestHandler } from './$types';

/** The What's new card was closed: not shown again for this version (src/lib/server/whatsNewCard.ts). */
export const POST: RequestHandler = async ({ cookies }) => {
	whatsNewSeen(cookies);
	return json({ ok: true });
};
