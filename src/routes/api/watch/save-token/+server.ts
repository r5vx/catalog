import { json, error } from '@sveltejs/kit';
import { updateSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { token?: string };
	const token = body?.token?.trim();

	if (!token) return error(400, 'No token');

	updateSettings({ febboxToken: token });
	return json({ ok: true });
};
