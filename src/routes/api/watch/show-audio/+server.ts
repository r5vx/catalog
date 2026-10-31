import { json } from '@sveltejs/kit';
import { getOrderCache, saveOrderCache } from '$lib/server/db/queries';
import { currentProfile } from '$lib/server/profile';
import type { RequestHandler } from './$types';

/**
 * Japanese or the dub, as last heard in an anime, per profile: kept in the library as well as in
 * the browser, which lost it (the owner's copy kept no localStorage after 2026-10-10, so Dungeon
 * Meshi came back on the dub after every update). TVs and phones get it too.
 * GET ?title= → { audio } ('Japanese' | 'English' | ''); POST { title, audio }.
 */
const keyFor = (title: string) => `show-audio|${currentProfile()}|${title.trim().toLowerCase()}`;

export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title') ?? '';
	if (!title.trim()) return json({ audio: '' });
	const kept = getOrderCache(keyFor(title))?.value;
	return json({ audio: kept === 'Japanese' || kept === 'English' ? kept : '' });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { title?: string; audio?: string } | null;
	const title = String(body?.title ?? '');
	const audio = body?.audio === 'Japanese' || body?.audio === 'English' ? body.audio : '';
	if (title.trim() && audio) saveOrderCache(keyFor(title), audio, Date.now());
	return json({ ok: true });
};
