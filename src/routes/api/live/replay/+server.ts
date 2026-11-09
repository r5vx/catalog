import { error, json } from '@sveltejs/kit';
import { replayAnswer } from '$lib/server/replayAnswer';
import { getWatchProgress } from '$lib/server/db/queries';
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
	// The Roku: held at the replay's top quality (MinBandwidth, kbps). Left to itself it dropped to a
	// blurry one now and then, and came back (a college football replay, 2026-11-08); Catalog's own
	// player never lowers the quality by itself.
	const fromRoku = /CatalogTV\/.*Roku/.test(request.headers.get('user-agent') ?? '');
	const minBandwidth = fromRoku && answer.url ? await topBandwidth(new URL(answer.url, url.origin).href, request.headers.get('cookie') ?? '') : 0;
	return json({ ...answer, resumeAt, minBandwidth });
};

/** A playlist's highest quality a Roku plays (H.264, no Dolby sound), in kbps; 0 for one quality or no answer. */
async function topBandwidth(playlist: string, cookie: string): Promise<number> {
	try {
		const r = await fetch(playlist, { headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(8000) });
		if (!r.ok) return 0;
		const qualities = ((await r.text()).match(/#EXT-X-STREAM-INF:[^\n]*/g) ?? []).filter((line) => !/hvc1|hev1|ec-3|ac-3/i.test(line));
		const bandwidths = qualities.map((line) => Number(/[:,]BANDWIDTH=(\d+)/.exec(line)?.[1] ?? 0));
		return bandwidths.length > 1 ? Math.floor(Math.max(...bandwidths) / 1000) : 0;
	} catch {
		return 0;
	}
}
