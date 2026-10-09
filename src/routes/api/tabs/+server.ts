import { json, error } from '@sveltejs/kit';
import { updateSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

const isKeyList = (value: unknown): value is string[] =>
	Array.isArray(value) && value.length <= 100 && value.every((key) => typeof key === 'string' && /^[a-z0-9-]{1,40}$/.test(key));

/**
 * Saves the library tabs' layout. Body: { hidden?: ["notes", …], order?: ["all", "anime", …] }.
 * Either can be sent alone.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { hidden, order } = await request.json();
	if (hidden !== undefined && !isKeyList(hidden)) return error(400, 'Bad list of tabs');
	if (order !== undefined && !isKeyList(order)) return error(400, 'Bad tab order');
	if (hidden !== undefined) updateSettings({ hiddenTabs: [...new Set(hidden)].join(',') });
	if (order !== undefined) updateSettings({ tabOrder: [...new Set(order)].join(',') });
	return json({ ok: true });
};
