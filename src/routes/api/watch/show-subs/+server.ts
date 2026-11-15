import { json } from '@sveltejs/kit';
import { getOrderCache, saveOrderCache } from '$lib/server/db/queries';
import { currentProfile } from '$lib/server/profile';
import type { RequestHandler } from './$types';

/**
 * The subtitle file a show was last watched with (its name and language), per profile: the next
 * episode looks for one from the same release. Kept in the library as well as in the browser: in
 * the browser alone it was lost whenever local storage was (the owner's copy, 2026-10-10 to
 * 11-01), and a TV or phone never had it, so a show started again on a file timed for another
 * release (a friend's So I'm a Spider, So What?, 2026-11-15).
 * GET ?title= → { fileName, language } or {}; POST { title, fileName, language }.
 */
const keyFor = (title: string) => `show-subs|${currentProfile()}|${title.trim().toLowerCase()}`;

export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title') ?? '';
	if (!title.trim()) return json({});
	const kept = getOrderCache(keyFor(title))?.value as { fileName?: string; language?: string } | undefined;
	return json(kept?.fileName ? { fileName: kept.fileName, language: kept.language ?? 'English' } : {});
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { title?: string; fileName?: string; language?: string } | null;
	const title = String(body?.title ?? '');
	const fileName = String(body?.fileName ?? '').slice(0, 300);
	const language = String(body?.language ?? 'English').slice(0, 40);
	if (title.trim() && fileName) saveOrderCache(keyFor(title), { fileName, language }, Date.now());
	return json({ ok: true });
};
