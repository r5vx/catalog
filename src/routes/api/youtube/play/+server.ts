import { json, error } from '@sveltejs/kit';
import { inDesktopApp, isVideoId, keptSeconds, readIndex, startCapture } from '$lib/server/youtube';
import type { RequestHandler } from './$types';

/**
 * Starts a YouTube video for a Roku (or the computer's test page): the desktop app's hidden
 * player keeps its pieces (electron/youtubeHelper.cjs), and this answers once there's enough to
 * start (12 s of both picture and sound), with the stream's address. `from`: a place further in,
 * which the hidden player then moves to.
 */
export const GET: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('v') ?? '';
	const from = Number(url.searchParams.get('from')) || 0;
	if (!isVideoId(id)) return error(400, 'Missing v');
	if (!inDesktopApp()) return error(409, 'YouTube for TVs needs Catalog open on the computer');
	startCapture(id, from);
	const until = Date.now() + 45_000;
	while (Date.now() < until) {
		const index = readIndex(id);
		if (index?.error) return json({ error: index.error }, { status: 502 });
		if (index && index.video && index.audio && (index.done || keptSeconds(index) >= Math.min(12, index.duration || 12))) {
			return json({ url: `/api/youtube/hls/${id}/main.m3u8`, duration: index.duration, height: index.height });
		}
		await new Promise((r) => setTimeout(r, 400));
	}
	return json({ error: "YouTube didn't start this video in time." }, { status: 504 });
};
