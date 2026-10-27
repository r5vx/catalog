import { error, json } from '@sveltejs/kit';
import { getDownload, removeDownload, retryDownload } from '$lib/server/downloads';
import { saveDownloadPlace } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

/** One download, for the player. */
export const GET: RequestHandler = async ({ params }) => {
	const download = getDownload(Number(params.id));
	if (!download) return error(404, 'That download is gone');
	return json(download);
};

/** { retry: true }: a failed one tried again; { place, duration }: where it was left. */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (!getDownload(id)) return error(404, 'That download is gone');
	const body = await request.json().catch(() => null);
	if (body?.retry) retryDownload(id);
	else if (Number.isFinite(body?.place)) saveDownloadPlace(id, Number(body.place), Number(body.duration) || 0);
	return json({ ok: true });
};

/** Deleted, with its file (stopped first if it's downloading). */
export const DELETE: RequestHandler = async ({ params }) => {
	removeDownload(Number(params.id));
	return json({ ok: true });
};
