import { json, error } from '@sveltejs/kit';
import { getOrderCache, saveOrderCache } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

/**
 * Intros and credits the player found itself by comparing episodes' sound (src/lib/skipFinder.ts),
 * kept per Showbox file so each is only worked out once. An empty list means it was looked for
 * and nothing was found; `null` that it hasn't been looked for.
 */

type Found = { type: 'intro' | 'credits'; start: number; end: number };

const keyFor = (fid: number) => `skip-found|${fid}`;

export const GET: RequestHandler = async ({ url }) => {
	const fid = Number(url.searchParams.get('fid'));
	if (!Number.isInteger(fid) || fid <= 0) return error(400, 'Missing fid');
	return json({ segments: (getOrderCache(keyFor(fid))?.value as Found[] | undefined) ?? null });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { found?: { fid: number; segments: Found[] }[] };
	for (const { fid, segments } of body.found ?? []) {
		if (!Number.isInteger(fid) || fid <= 0 || !Array.isArray(segments)) continue;
		const clean = segments
			.filter((s) => (s.type === 'intro' || s.type === 'credits') && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
			.map((s) => ({ type: s.type, start: Math.round(s.start * 10) / 10, end: Math.round(s.end * 10) / 10 }));
		saveOrderCache(keyFor(fid), clean, Date.now());
	}
	return json({ ok: true });
};
