import { json, error } from '@sveltejs/kit';
import { getOrderCache, saveOrderCache } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

/**
 * Intros and credits the player found itself by comparing episodes' sound (src/lib/skipFinder.ts),
 * kept per copy so each is only worked out once. A copy is a Showbox file's number, or another
 * source's share key (skipKeyOf). An empty list means it was looked for and nothing was found;
 * `null` that it hasn't been looked for.
 */

type Found = { type: 'intro' | 'credits'; start: number; end: number };

/** A Showbox file number, or a share key of another source's (7Movies, Movy, Aniwave). */
const isKey = (key: string) => /^\d+$/.test(key) || /^(vidrift|movy|aniwave):[\w:.-]{3,120}$/.test(key);
const keyFor = (key: string) => `skip-found|${key}`;

/** ?key=, or ?fid= for a Showbox file. */
export const GET: RequestHandler = async ({ url }) => {
	const key = url.searchParams.get('key') ?? url.searchParams.get('fid') ?? '';
	if (!isKey(key) || key === '0') return error(400, 'Missing key');
	return json({ segments: (getOrderCache(keyFor(key))?.value as Found[] | undefined) ?? null });
};

/** Body: { found: [{ key (or fid), segments }] }. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { found?: { key?: string; fid?: number; segments: Found[] }[] };
	for (const { key: given, fid, segments } of body.found ?? []) {
		const key = String(given ?? fid ?? '');
		if (!isKey(key) || key === '0' || !Array.isArray(segments)) continue;
		const clean = segments
			.filter((s) => (s.type === 'intro' || s.type === 'credits') && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
			.map((s) => ({ type: s.type, start: Math.round(s.start * 10) / 10, end: Math.round(s.end * 10) / 10 }));
		saveOrderCache(keyFor(key), clean, Date.now());
	}
	return json({ ok: true });
};
