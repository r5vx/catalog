import { json } from '@sveltejs/kit';
import { addPlaybackStop, playbackStops } from '$lib/server/playbackLog';
import { reportProblem } from '$lib/server/online';
import { reportScreen } from '$lib/server/reportScreen';
import type { RequestHandler } from './$types';

/** The stops kept (newest first). */
export const GET: RequestHandler = () => json(playbackStops());

/** How long a stop has to last to be sent to the owner. */
const REPORT_FROM_SECONDS = 4;

/**
 * Whether a stop-log entry is worth a problem report to the owner. Owner, 2026-11-15: reports
 * were full of things that aren't bugs. Everything stays in this computer's own stop log; only
 * these are sent: a stop of 4 s or more (or one still stopped after 30 s), and a picture that
 * froze while the sound played on. Not sent: short stops, "went back N s by itself" (the five on
 * the server that day were all these, 1.6 to 5.5 s, mostly moved by Catalog's own code after a
 * quality change or resume) and "reloaded by itself".
 */
function worthReporting(seen: Record<string, unknown>): boolean {
	if (typeof seen.what === 'string') return seen.what.startsWith('Picture froze') || seen.what.startsWith('Player crashed');
	const seconds = Number(seen.stoppedSeconds);
	return seen.ended === 'still' || (Number.isFinite(seconds) && seconds >= REPORT_FROM_SECONDS);
}

/** A video stopped to load: what the player saw (src/lib/server/playbackLog.ts). */
export const POST: RequestHandler = async ({ request }) => {
	const seen = await request.json().catch(() => null);
	if (!seen || typeof seen !== 'object') return json({ ok: false }, { status: 400 });
	const stop = addPlaybackStop(seen as Record<string, unknown>);
	// Sent to the owner too (Settings → Online), when this Catalog is online and reports are on.
	if (worthReporting(seen as Record<string, unknown>)) reportProblem('stop', String((seen as { title?: unknown }).title ?? 'A video').slice(0, 160), { ...reportScreen(request), ...stop });
	return json({ ok: true });
};
