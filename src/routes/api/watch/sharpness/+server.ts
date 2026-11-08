import { json } from '@sveltejs/kit';
import { keptSharpness, measureCopy, noteSharpness, type Sharpness } from '$lib/server/copySharpness';
import type { RequestHandler } from './$types';

/**
 * Each copy's real sharpness (copySharpness.ts says why).
 *
 * GET ?keys=fid:1,<share key>,… → { "<key>": { mbps, height, from, at } }
 * POST { key, mbps, height }: what the player measured of the copy it's playing.
 * POST { measure: [{ key, shareKey, fid }] }: measures copies nobody has played yet (a few at a
 * time, one after another), and answers with all of them.
 */
const MAX_KEYS = 60;
const MAX_MEASURE = 6;

export const GET: RequestHandler = async ({ url }) => {
	const keys = (url.searchParams.get('keys') ?? '').split(',').filter(Boolean).slice(0, MAX_KEYS);
	return json(keptSharpness(keys));
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as {
		key?: string;
		mbps?: number;
		height?: number;
		measure?: { key?: string; shareKey?: string; fid?: number }[];
	} | null;
	if (Array.isArray(body?.measure)) {
		const out: Record<string, Sharpness> = {};
		for (const copy of body.measure.slice(0, MAX_MEASURE)) {
			const key = String(copy?.key ?? '').slice(0, 300);
			const shareKey = String(copy?.shareKey ?? '').slice(0, 300);
			const fid = Number(copy?.fid);
			if (!key || !shareKey || !Number.isFinite(fid)) continue;
			const found = await measureCopy(key, shareKey, fid);
			if (found) out[key] = found;
		}
		return json(out);
	}
	const kept = noteSharpness(String(body?.key ?? '').slice(0, 300), Number(body?.mbps), Number(body?.height), 'played');
	return json({ ok: Boolean(kept) });
};
