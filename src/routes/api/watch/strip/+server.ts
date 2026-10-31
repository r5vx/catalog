import { json, error } from '@sveltejs/kit';
import { addToStrip, stripFor, stripKey } from '$lib/server/previewStrips';
import type { RequestHandler } from './$types';

/** Which video: title, type, season, episode and its length in seconds (null without them). */
const videoFrom = (params: URLSearchParams | Record<string, unknown>) => {
	const get = (name: string) => (params instanceof URLSearchParams ? params.get(name) : params[name]);
	const title = String(get('title') ?? '').trim();
	const length = Number(get('length'));
	if (!title || !(length > 0)) return null;
	return { title, type: String(get('type') ?? 'movie'), season: Number(get('season') ?? 0), episode: Number(get('episode') ?? 0), length };
};

const keyFrom = (params: URLSearchParams | Record<string, unknown>) => {
	const v = videoFrom(params);
	return v ? stripKey(v.title, v.type, v.season, v.episode, v.length) : null;
};

/** A film's or episode's saved preview pictures, for a copy this long. ?title=&type=&season=&episode=&length= */
export const GET: RequestHandler = async ({ url }) => {
	const v = videoFrom(url.searchParams);
	if (!v) error(400, 'Which video?');
	return json({ frames: stripFor(v.title, v.type, v.season, v.episode, v.length).frames });
};

/** Pictures to keep: { title, type, season, episode, length, frames: { "<second>": "<base64 JPEG>" } }. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const key = body ? keyFrom(body) : null;
	if (!key || !body.frames || typeof body.frames !== 'object') error(400, 'Nothing to keep');
	return json({ count: addToStrip(key, body.frames) });
};
