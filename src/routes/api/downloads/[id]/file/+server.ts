import { error } from '@sveltejs/kit';
import { existsSync } from 'node:fs';
import { fileOf, getDownload } from '$lib/server/downloads';
import { sendFile } from '$lib/server/sendFile';
import { downloadName } from '$lib/downloadName';
import type { RequestHandler } from './$types';

/** A finished download's video, for the player (with seeking), or ?save=1 to keep on this device. */
export const GET: RequestHandler = async ({ params, url, request }) => {
	const download = getDownload(Number(params.id));
	if (!download || download.state !== 'done' || !existsSync(fileOf(download.id))) return error(404, "That download isn't ready");
	const saveAs = url.searchParams.get('save') === '1' ? `${downloadName(download)}.mp4` : undefined;
	return sendFile(fileOf(download.id), 'video/mp4', request.headers.get('range'), saveAs);
};
