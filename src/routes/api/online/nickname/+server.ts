import { json } from '@sveltejs/kit';
import { setNickname } from '$lib/server/friendNicknames';
import { currentProfile } from '$lib/server/profile';
import type { RequestHandler } from './$types';

/** POST { id, nickname }: what this profile calls a friend ('' goes back to their own name). Kept on this computer only. */
export const POST: RequestHandler = async ({ request }) => {
	const sent = (await request.json().catch(() => ({}))) as { id?: unknown; nickname?: unknown };
	if (typeof sent.id !== 'string' || !/^[A-Z0-9]{16}$/.test(sent.id)) return json({ ok: false }, { status: 400 });
	setNickname(currentProfile(), sent.id, typeof sent.nickname === 'string' ? sent.nickname : '');
	return json({ ok: true });
};
