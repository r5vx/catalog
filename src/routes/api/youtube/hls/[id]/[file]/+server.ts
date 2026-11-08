import { error } from '@sveltejs/kit';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isVideoId, mainPlaylist, readIndex, startCapture, trackPlaylist, youtubeDir } from '$lib/server/youtube';
import type { RequestHandler } from './$types';

const PLAYLIST = { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' };

/** A kept YouTube video as HLS (src/lib/server/youtube.ts): main.m3u8, video.m3u8, audio.m3u8 and the pieces. */
export const GET: RequestHandler = async ({ params }) => {
	const { id, file } = params;
	if (!isVideoId(id) || !/^[\w.-]+$/.test(file)) return error(404, 'Not found');
	const index = readIndex(id);
	if (!index || !index.video || !index.audio) return error(404, 'Not kept');
	if (file === 'main.m3u8') return new Response(mainPlaylist(index), { headers: PLAYLIST });
	if (file === 'video.m3u8' || file === 'audio.m3u8') {
		// (Catalog restarted part way: the hidden player carries on.)
		if (!index.done) startCapture(id);
		return new Response(trackPlaylist(index, file === 'video.m3u8' ? 'video' : 'audio'), { headers: PLAYLIST });
	}
	const path = join(youtubeDir, id, file);
	if (!/\.(mp4|m4s)$/.test(file) || !existsSync(path)) return error(404, 'Not found');
	return new Response(readFileSync(path), {
		headers: { 'Content-Type': file.endsWith('.mp4') ? 'video/mp4' : 'video/iso.segment', 'Cache-Control': 'max-age=86400' }
	});
};
