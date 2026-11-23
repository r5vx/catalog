import { json } from '@sveltejs/kit';
import { getOrderCache, saveOrderCache } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

/**
 * Copies whose picture glitches, marked by hand in the player's Files menu ("Picture glitching").
 * Febbox's own pieces can decode with no errors and still be smeared (Re:Zero S3E4's "dual" file,
 * 2026-11-18), so nothing can find them by itself. Kept in the library for every profile and screen:
 * a marked copy, and that kind of file for the rest of its season, isn't picked again.
 *
 * GET ?title= → { copies: Glitchy[] }; POST { title, season, fid, kind, source }.
 */
type Glitchy = { fid: number; kind: string; season: number; source: string };
const keyFor = (title: string) => `glitchy|${title.trim().toLowerCase()}`;

const read = (title: string): Glitchy[] => {
	const kept = getOrderCache(keyFor(title))?.value;
	return Array.isArray(kept) ? (kept as Glitchy[]) : [];
};

export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title') ?? '';
	return json({ copies: title.trim() ? read(title) : [] });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as Partial<Glitchy> & { title?: string } | null;
	const title = String(body?.title ?? '');
	if (!title.trim()) return json({ ok: false });
	const mark: Glitchy = {
		fid: Number(body?.fid) || 0,
		kind: String(body?.kind ?? '').slice(0, 200),
		season: Number(body?.season) || 0,
		source: String(body?.source ?? '').slice(0, 40)
	};
	const copies = read(title).filter((c) => !(c.fid === mark.fid && c.source === mark.source));
	copies.push(mark);
	saveOrderCache(keyFor(title), copies.slice(-100), Date.now());
	return json({ ok: true });
};
