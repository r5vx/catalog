import { json, error } from '@sveltejs/kit';
import { downloadKindOf, finishedWith, piecesHeld } from '$lib/server/episodeDownloads';
import { downloadCopyAhead } from '$lib/server/downloadAheadAsk';
import type { RequestHandler } from './$types';

/**
 * The next episode, downloaded onto this computer while this one plays (7Movies and Movy only:
 * episodeDownloads.ts says why), so it starts with nothing to wait for. Body: { share_key, fid }
 * of the copy the player will play. Answers at once; the downloading goes on here.
 * (src/lib/server/downloadAheadAsk.ts does the asking.)
 */
/**
 * Which pieces of a copy (?copy=<copy>~v<n>, as the relay names a quality's playlist) are on
 * this computer: the player's bar shows them as a lighter shade past what it holds itself.
 */
export const GET: RequestHandler = async ({ url }) => {
	return json(piecesHeld(url.searchParams.get('copy') ?? '') ?? { held: [], total: 0, going: 0 });
};

/** Watched to the end (?copy=<share key>): its download goes a few minutes after nobody's playing it. */
export const DELETE: RequestHandler = async ({ url }) => {
	finishedWith(url.searchParams.get('copy') ?? '');
	return json({ ok: true });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const shareKey = typeof body?.share_key === 'string' ? body.share_key : '';
	const fid = Number(body?.fid);
	// (A Showbox copy: a Febbox share key and its file number, downloaded only while there's room.)
	const showbox = fid > 0 && !downloadKindOf(shareKey);
	if (!shareKey || !fid || (!downloadKindOf(shareKey) && !showbox)) return error(400, 'Not a copy that is downloaded ahead');
	void downloadCopyAhead(shareKey, fid, 0, 0, showbox);
	return json({ ok: true });
};
