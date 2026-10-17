import { error } from '@sveltejs/kit';
import { readSpeech, keepSpeech } from '$lib/server/heardSpeech';
import type { RequestHandler } from './$types';

/** The talking auto-timing heard in a Showbox file (src/lib/server/heardSpeech.ts). ?fid=&lang= */
export const GET: RequestHandler = async ({ url }) => {
	const fid = Number(url.searchParams.get('fid'));
	if (!Number.isInteger(fid) || fid <= 0) return error(400, 'Missing fid');
	const bytes = readSpeech(fid, url.searchParams.get('lang') ?? '');
	if (!bytes) return new Response(null, { status: 404 });
	return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/octet-stream' } });
};

export const POST: RequestHandler = async ({ url, request }) => {
	const fid = Number(url.searchParams.get('fid'));
	if (!Number.isInteger(fid) || fid <= 0) return error(400, 'Missing fid');
	keepSpeech(fid, url.searchParams.get('lang') ?? '', new Uint8Array(await request.arrayBuffer()));
	return new Response(null, { status: 204 });
};
