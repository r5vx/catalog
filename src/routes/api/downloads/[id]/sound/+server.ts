import { error } from '@sveltejs/kit';
import { existsSync } from 'node:fs';
import { fileOf, getDownload } from '$lib/server/downloads';
import { soundInit, soundPiece, soundPlaylist } from '$lib/server/mp4Sound';
import type { RequestHandler } from './$types';

/**
 * A download's sound track as HLS, for auto-timing its subtitles offline (mp4Sound.ts):
 * ?p=master (a playlist naming the track, as Showbox's does), ?p=track, ?p=init, ?p=<number>.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const download = getDownload(Number(params.id));
	if (!download || download.state !== 'done' || !existsSync(fileOf(download.id))) return error(404, "That download isn't ready");
	const file = fileOf(download.id);
	const here = `/api/downloads/${download.id}/sound?p=`;
	const part = url.searchParams.get('p') ?? 'master';
	const playlist = (body: string) => new Response(body, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
	const bytes = (body: Uint8Array | null) =>
		body ? new Response(new Uint8Array(body), { headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, max-age=3600' } }) : error(404, 'No such piece');

	if (part === 'master') {
		return playlist(
			['#EXTM3U', `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="sound",NAME="Sound",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="${here}track"`, '#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="sound"', `/api/downloads/${download.id}/file`].join('\n')
		);
	}
	if (part === 'track') {
		const text = soundPlaylist(file, here);
		return text ? playlist(text) : error(404, 'No sound in that download');
	}
	if (part === 'init') return bytes(soundInit(file));
	return bytes(soundPiece(file, Number(part)));
};
