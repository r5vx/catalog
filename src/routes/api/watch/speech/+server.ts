import { error } from '@sveltejs/kit';
import { readSpeech, keepSpeech, speechIsPartial, type SpeechKey } from '$lib/server/heardSpeech';
import type { RequestHandler } from './$types';

/**
 * The talking auto-timing heard in a copy (src/lib/server/heardSpeech.ts): ?fid= (a Showbox file)
 * or ?copy= (another copy's share key), and &lang=.
 * `X-Speech-Partial: 1` when only part of it has been heard yet.
 */
function keyOf(url: URL): SpeechKey | null {
	const copy = url.searchParams.get('copy');
	if (copy) return copy.length <= 300 ? copy : null;
	const fid = Number(url.searchParams.get('fid'));
	return Number.isInteger(fid) && fid > 0 ? fid : null;
}

export const GET: RequestHandler = async ({ url }) => {
	const key = keyOf(url);
	if (key === null) return error(400, 'Missing fid or copy');
	const language = url.searchParams.get('lang') ?? '';
	const bytes = readSpeech(key, language);
	if (!bytes) return new Response(null, { status: 404 });
	const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
	if (speechIsPartial(key, language)) headers['X-Speech-Partial'] = '1';
	return new Response(new Uint8Array(bytes), { headers });
};

/** ?fid= or ?copy=, &lang=, and &partial=1 while the rest is still being heard. */
export const POST: RequestHandler = async ({ url, request }) => {
	const key = keyOf(url);
	if (key === null) return error(400, 'Missing fid or copy');
	keepSpeech(key, url.searchParams.get('lang') ?? '', new Uint8Array(await request.arrayBuffer()), url.searchParams.get('partial') === '1');
	return new Response(null, { status: 204 });
};
