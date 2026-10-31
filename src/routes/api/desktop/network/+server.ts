import { json, error } from '@sveltejs/kit';
import { leavePublic, makePrivate } from '$lib/server/networkType';
import { onThisComputer } from '$lib/server/profile';
import type { RequestHandler } from './$types';

/** The Public network notice (networkType.ts): { action: 'private' | 'leave' }, from this computer only. */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	let address = '';
	try {
		address = getClientAddress();
	} catch {}
	if (!onThisComputer(request.headers, address)) return error(403, 'Only from the computer Catalog runs on');
	const { action } = (await request.json().catch(() => ({}))) as { action?: string };
	if (action === 'private') return json({ ok: await makePrivate() });
	if (action === 'leave') {
		leavePublic();
		return json({ ok: true });
	}
	return error(400, 'What to do?');
};
