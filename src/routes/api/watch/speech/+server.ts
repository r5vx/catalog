import { error } from '@sveltejs/kit';
import { readSpeech, keepSpeech, speechIsPartial } from '$lib/server/heardSpeech';
import type { RequestHandler } from './$types';

/**
 * The talking auto-timing heard in a Showbox file (src/lib/server/heardSpeech.ts). ?fid=&lang=
 * `X-Speech-Partial: 1` when the computer is still hearing it (only part is there yet).
 */
export const GET: RequestHandler = async ({ url }) => {
	const fid = Number(url.searchParams.get('fid'));
	if (!Number.isInteger(fid) || fid <= 0) return error(400, 'Missing fid');
	const language = url.searchParams.get('lang') ?? '';
	const bytes = readSpeech(fid, language);
	if (!bytes) return new Response(null, { status: 404 });
	const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
	if (speechIsPartial(fid, language)) headers['X-Speech-Partial'] = '1';
	return new Response(new Uint8Array(bytes), { headers });
};

/** ?fid=&lang=, and &partial=1 while the rest is still being heard. */
export const POST: RequestHandler = async ({ url, request }) => {
	const fid = Number(url.searchParams.get('fid'));
	if (!Number.isInteger(fid) || fid <= 0) return error(400, 'Missing fid');
	keepSpeech(fid, url.searchParams.get('lang') ?? '', new Uint8Array(await request.arrayBuffer()), url.searchParams.get('partial') === '1');
	return new Response(null, { status: 204 });
};
