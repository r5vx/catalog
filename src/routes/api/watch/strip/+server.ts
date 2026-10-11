import { json, error } from '@sveltejs/kit';
import { addToStrip, readStrip, stripKey } from '$lib/server/previewStrips';
import type { RequestHandler } from './$types';

const keyFrom = (params: URLSearchParams | Record<string, unknown>) => {
	const get = (name: string) => (params instanceof URLSearchParams ? params.get(name) : params[name]);
	const title = String(get('title') ?? '').trim();
	if (!title) return null;
	return stripKey(title, String(get('type') ?? 'movie'), Number(get('season') ?? 0), Number(get('episode') ?? 0));
};

/** A film's or episode's saved preview pictures. ?title=&type=&season=&episode= */
export const GET: RequestHandler = async ({ url }) => {
	const key = keyFrom(url.searchParams);
	if (!key) error(400, 'Which video?');
	return json({ frames: readStrip(key).frames });
};

/** Pictures to keep: { title, type, season, episode, frames: { "<second>": "<base64 JPEG>" } }. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const key = body ? keyFrom(body) : null;
	if (!key || !body.frames || typeof body.frames !== 'object') error(400, 'Nothing to keep');
	return json({ count: addToStrip(key, body.frames) });
};
