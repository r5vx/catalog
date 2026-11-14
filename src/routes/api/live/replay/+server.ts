import { error, json } from '@sveltejs/kit';
import { replayAnswer } from '$lib/server/replayAnswer';
import { getWatchProgress } from '$lib/server/db/queries';
import { qualitiesAt, rokuScreen } from '$lib/server/rokuQualities';
import type { RequestHandler } from './$types';

/**
 * One replay for the player (?id=): its versions that play, and the address of one (&v=<which>),
 * the full game first (server/replayAnswer.ts).
 */
export const GET: RequestHandler = async ({ url, request }) => {
	const asked = url.searchParams.get('v');
	const answer = await replayAnswer(url.searchParams.get('id') ?? '', asked !== null ? Number(asked) : null);
	if (!answer) return error(404, "That replay isn't listed any more.");
	// Where this profile left it (the Roku starts there; Catalog's player asks for itself).
	const kept = answer.replay?.title ? getWatchProgress(answer.replay.title, 'replay', 0, 0) : null;
	const resumeAt = kept && kept.duration > 0 && kept.currentTime > 5 && kept.currentTime / kept.duration < 0.95 ? Math.round(kept.currentTime) : 0;
	// The Roku: held at the replay's best quality it can show (MinBandwidth, kbps), the next ones to
	// step down to if that won't start (server/rokuQualities.ts). Left to itself it dropped to a blurry
	// one now and then, and came back (a college football replay, 2026-11-08).
	const fromRoku = /CatalogTV\/.*Roku/.test(request.headers.get('user-agent') ?? '');
	const cookie = request.headers.get('cookie') ?? '';
	const qualities = fromRoku && answer.url ? await qualitiesAt(new URL(answer.url, url.origin).href, cookie ? { cookie } : {}, rokuScreen(request)) : [];
	const minBandwidth = qualities.length > 1 ? qualities[0] : 0;
	return json({ ...answer, resumeAt, minBandwidth, qualities });
};

