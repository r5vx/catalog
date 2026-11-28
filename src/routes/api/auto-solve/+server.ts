import { json } from '@sveltejs/kit';
import { readSettings, updateSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (typeof body?.on !== 'boolean') return json({ error: 'on or off?' }, { status: 400 });
	updateSettings({ autoSolve: body.on ? '' : '0' });
	return json({ on: readSettings().autoSolve !== '0' });
};
