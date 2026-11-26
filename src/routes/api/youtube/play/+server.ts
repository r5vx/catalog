import { json, error, redirect } from '@sveltejs/kit';
import { inDesktopApp, isVideoId, keptSeconds, readIndex, startCapture } from '$lib/server/youtube';
import { catalogDesktop, youtubePage } from '$lib/youtubeDevice';
import { confirmNative, officialFile, scopedPublisher } from '$lib/server/sources/official';
import { publisherReplay } from '$lib/server/sources/publisherReplays';
import { ambiguousRelease } from '$lib/server/seriesIdentity';
import { videoListing } from '$lib/server/sources/videoListing';
import type { RequestHandler } from './$types';

/**
 * Starts a YouTube video for a Roku (or the computer's test page): the desktop app's hidden
 * player keeps its pieces (electron/youtubeHelper.cjs), and this answers once there's enough to
 * start (12 s of both picture and sound), with the stream's address. `from`: a place further in,
 * which the hidden player then moves to.
 */
export const GET: RequestHandler = async ({ url, request }) => {
	const id = url.searchParams.get('v') ?? '';
	const from = Number(url.searchParams.get('from')) || 0;
	if (!isVideoId(id)) return error(400, 'Missing v');
	const scoped = url.searchParams.has('scope');
	if (url.searchParams.has('official') || (url.searchParams.has('open') && !scoped)) error(404, 'Choose a source from a title or a replay');
	const w = scoped && url.searchParams.get('scope') !== 'replay' ? await scopedPublisher(id, url.searchParams) : undefined;
	const replay = url.searchParams.get('scope') === 'replay' ? publisherReplay(id) : undefined;
	if (scoped) {
		if (!w && !replay) error(404, 'No matching title or replay');
		if (!url.searchParams.has('open') && !catalogDesktop(request.headers.get('user-agent') ?? '')) error(409, 'Use the Catalog desktop app');
		const listing = await videoListing(id, true);
		if (listing === 'unknown') return json({ error: 'YouTube did not answer. Try again later.' }, { status: 503 });
		if (listing === 'unavailable') return json({ error: 'This video is no longer public.' }, { status: 410 });
		if (url.searchParams.has('open')) redirect(302, youtubePage(id));
	}
	if (!inDesktopApp()) error(409, 'YouTube playback needs Catalog open on the computer');
	startCapture(id, from);
	const until = Date.now() + 45_000;
	while (Date.now() < until) {
		const index = readIndex(id);
		if (index?.error) return json({ error: index.error }, { status: 502 });
		if (index && index.video && index.audio && (index.done || keptSeconds(index) >= Math.min(12, index.duration || 12))) {
			const type = w?.tmdb.startsWith('tv:') ? 'tv' : 'movie';
			const label = w && await ambiguousRelease(w.title, type, String(w.year)) ? `${w.title} (${w.year})` : w?.title;
			const title = replay?.uploadTitle || (w?.season ? `${label} S${w.season}E${w.episode}` : label);
			const media = w && { type, title:w.title, year:w.year, season:w.season, episode:w.episode, poster:w.poster, file:officialFile(w) };
			return json({ title, media, url: `/api/youtube/hls/${id}/main.m3u8`, duration: index.duration, height: index.height });
		}
		await new Promise((r) => setTimeout(r, 400));
	}
	return json({ error: "YouTube didn't start this video in time." }, { status: 504 });
};

export const POST: RequestHandler = async ({ url, request }) => {
	if (!inDesktopApp() || request.headers.get('origin') !== url.origin || !catalogDesktop(request.headers.get('user-agent') ?? '')) error(403, 'Desktop playback required');
	const id = url.searchParams.get('v') || '';
	const work = url.searchParams.get('scope') === 'replay' ? publisherReplay(id) : await scopedPublisher(id, url.searchParams);
	if (!work) error(404, 'No matching title or replay');
	const index = readIndex(work.videoId);
	if (!index?.audio || !index.video || index.error || keptSeconds(index) <= 0) error(409, 'No media on this host');
	confirmNative(work);
	return new Response(null, { status: 204 });
};
