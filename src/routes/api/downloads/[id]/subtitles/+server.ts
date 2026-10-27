import { error } from '@sveltejs/kit';
import { existsSync, readFileSync } from 'node:fs';
import { getDownload, subtitlesOf } from '$lib/server/downloads';
import { attachment } from '$lib/server/sendFile';
import { downloadName } from '$lib/downloadName';
import type { RequestHandler } from './$types';

/** A download's subtitles (SRT), for the player, or ?save=1 as a file named like its video. */
export const GET: RequestHandler = async ({ params, url }) => {
	const download = getDownload(Number(params.id));
	if (!download || !existsSync(subtitlesOf(download.id))) return error(404, 'No subtitles with that download');
	const headers: Record<string, string> = { 'Content-Type': 'text/plain; charset=utf-8' };
	if (url.searchParams.get('save') === '1') headers['Content-Disposition'] = attachment(`${downloadName(download)}.srt`);
	return new Response(readFileSync(subtitlesOf(download.id), 'utf8'), { headers });
};
