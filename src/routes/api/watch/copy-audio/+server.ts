import { json } from '@sveltejs/kit';
import { getOrderCache, saveOrderCache } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

/**
 * The languages a copy's sound comes in, as its player found them the first time it played
 * (a Showbox copy of Re:Zero has Japanese and the English dub; another has Japanese only).
 * Shown in the player's Files menu on every screen, so the copy with both can be picked before
 * playing it. Kept per copy (Showbox file number, or another source's share key) in the library.
 *
 * GET ?keys=fid:1,aniwave:… → { "<key>": ["Japanese", "English"] | [] }  ([] = one sound track)
 * POST { key, languages }
 */
const MAX_KEYS = 60;
const keyFor = (copy: string) => `copy-audio|${copy}`;

export const GET: RequestHandler = async ({ url }) => {
	const keys = (url.searchParams.get('keys') ?? '').split(',').filter(Boolean).slice(0, MAX_KEYS);
	const out: Record<string, string[]> = {};
	for (const key of keys) {
		const kept = getOrderCache(keyFor(key))?.value;
		if (Array.isArray(kept)) out[key] = kept.map(String);
	}
	return json(out);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { key?: string; languages?: unknown } | null;
	const key = String(body?.key ?? '').slice(0, 300);
	const languages = Array.isArray(body?.languages) ? body.languages.map((l) => String(l).slice(0, 40)).slice(0, 12) : null;
	if (key && languages) saveOrderCache(keyFor(key), languages, Date.now());
	return json({ ok: true });
};
