import { error, json } from '@sveltejs/kit';
import { downloadProgress, freeSpace, listDownloads, startDownload, type DownloadAsk } from '$lib/server/downloads';
import { parseAniwaveShareKey } from '$lib/server/sources/aniwave';
import { parseVidriftShareKey } from '$lib/server/sources/vidrift';
import { parseMovyShareKey } from '$lib/server/sources/movy';
import type { RequestHandler } from './$types';

/** Every download, with how far the one under way has got, and the space left on the disk. */
export const GET: RequestHandler = async () => {
	const live = downloadProgress();
	const downloads = listDownloads().map((d) => {
		const now = live.get(d.id);
		return now ? { ...d, donePieces: now.done, totalPieces: now.total, bytes: now.bytes, speed: now.speed } : { ...d, speed: 0 };
	});
	return json({ downloads, free: freeSpace() });
};

/** A download started, of what the player is playing (downloads.ts, DownloadAsk). */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body.title !== 'string' || !body.title.trim()) return error(400, 'What to download?');
	const kind = body.kind === 'replay' ? 'replay' : body.kind === 'episode' ? 'episode' : 'film';
	if (kind === 'replay' ? !body.replayId : !body.shareKey || !body.fid) return error(400, 'Which copy?');
	// Never Showbox's copy: it would use up Febbox's daily allowance (another source's, or a replay).
	const key = String(body.shareKey ?? '');
	if (kind !== 'replay' && !parseAniwaveShareKey(key) && !parseVidriftShareKey(key) && !parseMovyShareKey(key)) {
		return error(400, "Showbox's copies aren't downloaded (they'd use up Febbox's daily allowance)");
	}
	const text = (v: unknown) => (typeof v === 'string' && v ? v : null);
	const ask: DownloadAsk = {
		kind,
		title: body.title.trim(),
		year: String(body.year ?? ''),
		season: Number(body.season) || 0,
		episode: Number(body.episode) || 0,
		episodeName: text(body.episodeName),
		poster: text(body.poster),
		source: String(body.source ?? ''),
		shareKey: text(body.shareKey),
		fid: Number(body.fid) || null,
		replayId: text(body.replayId),
		replayVersion: Number.isInteger(body.replayVersion) ? body.replayVersion : null,
		height: Number(body.height) || 0,
		audio: String(body.audio ?? ''),
		subtitles: text(body.subtitles),
		estimate: Number(body.estimate) || 0
	};
	return json(startDownload(ask));
};
