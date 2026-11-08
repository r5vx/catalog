import { error, json } from '@sveltejs/kit';
import { downloadTitle, titleDownloads } from '$lib/server/titleDownloads';
import type { RequestHandler } from './$types';

const typeOf = (v: unknown): 'tv' | 'movie' => (v === 'tv' ? 'tv' : 'movie');

/** What a title's page can download (titleDownloads.ts): the film, or each episode. */
export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim();
	if (!title) return error(400, 'Which title?');
	return json(await titleDownloads(title, typeOf(url.searchParams.get('type')), url.searchParams.get('year') ?? ''));
};

/** A film, or the episodes picked, put into Downloads. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body.title !== 'string' || !body.title.trim()) return error(400, 'Which title?');
	const type = typeOf(body.type);
	const episodes = Array.isArray(body.episodes) ? body.episodes.filter((e: unknown) => typeof e === 'string' && /^\d+:\d+$/.test(e)) : null;
	if (type === 'tv' && !episodes?.length) return error(400, 'Which episodes?');
	const answer = await downloadTitle({
		title: body.title.trim(),
		type,
		year: String(body.year ?? ''),
		poster: typeof body.poster === 'string' && body.poster ? body.poster : null,
		episodes: type === 'tv' ? episodes : null,
		height: Number(body.height) || 0,
		captions: body.captions === true
	});
	if (!answer) return error(502, "This title can't be looked up right now");
	return json(answer);
};
