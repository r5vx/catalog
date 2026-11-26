import { error, json } from '@sveltejs/kit';
import { existsSync, readFileSync } from 'node:fs';
import { catalogDesktop } from '$lib/youtubeDevice';
import { join } from 'node:path';
import { autoCaptions, isVideoId, keptSeconds, mainPlaylist, readIndex, startCapture, trackPlaylist, youtubeDir } from '$lib/server/youtube';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, url }) => {
	if (params.file !== 'captions.json' || !isVideoId(params.id)) return error(404, 'Not found');
	if (request.headers.get('origin') !== url.origin || !catalogDesktop(request.headers.get('user-agent') ?? '')) return error(403, 'Desktop playback required');
	if (request.headers.get('content-type') !== 'application/json') return error(415, 'JSON required');
	const tracks = await autoCaptions(params.id);
	if (!tracks) return error(404, 'Captions unavailable');
	return json({id:params.id, tracks}, {headers:{'Cache-Control':'no-store'}});
};

const PLAYLIST = { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' };

/** A kept YouTube video as HLS (src/lib/server/youtube.ts): main.m3u8, video.m3u8, audio.m3u8 and the pieces. */
export const GET: RequestHandler = async ({ params }) => {
	const { id, file } = params;
	if (!isVideoId(id) || !/^[\w.-]+$/.test(file)) return error(404, 'Not found');
	const index = readIndex(id);
	if (!index || !index.video || !index.audio) return error(404, 'Not kept');
	if (file === 'main.m3u8') return new Response(mainPlaylist(index), { headers: PLAYLIST });
	// The whole video's length, known from the start: the playlists only list what's kept so far, so
	// the player's bar grew a few seconds at a time instead of showing the full length (owner, 2026-11-26).
	if (file === 'length.json') return json({ duration: index.duration || 0, kept: keptSeconds(index), done: index.done }, { headers: { 'Cache-Control': 'no-store' } });
	if (file === 'video.m3u8' || file === 'audio.m3u8') {
		// (Catalog restarted part way: the hidden player carries on.)
		if (!index.done) startCapture(id, 0, true);
		return new Response(trackPlaylist(index, file === 'video.m3u8' ? 'video' : 'audio'), { headers: PLAYLIST });
	}
	const path = join(youtubeDir, id, file);
	if (!/\.(mp4|m4s)$/.test(file) || !existsSync(path)) return error(404, 'Not found');
	return new Response(readFileSync(path), {
		headers: { 'Content-Type': file.endsWith('.mp4') ? 'video/mp4' : 'video/iso.segment', 'Cache-Control': 'max-age=86400' }
	});
};
