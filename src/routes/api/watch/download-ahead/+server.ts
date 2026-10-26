import { json, error } from '@sveltejs/kit';
import { downloadAhead, downloadKindOf, finishedWith, piecesHeld } from '$lib/server/episodeDownloads';
import type { RequestHandler } from './$types';

/**
 * The next episode, downloaded onto this computer while this one plays (7Movies and Movy only:
 * episodeDownloads.ts says why), so it starts with nothing to wait for. Body: { share_key, fid }
 * of the copy the player will play. Answers at once; the downloading goes on here.
 *
 * Its playlists are asked for the way the player asks (this server's own /api/watch/stream and
 * relay), so the pieces are noted under the same copy name the player will use.
 */
/**
 * Which pieces of a copy (?copy=<copy>~v<n>, as the relay names a quality's playlist) are on
 * this computer: the player's bar shows them as a lighter shade past what it holds itself.
 */
export const GET: RequestHandler = async ({ url }) => {
	return json(piecesHeld(url.searchParams.get('copy') ?? '') ?? { held: [], total: 0, going: 0 });
};

/** Watched to the end (?copy=<share key>): its download goes a few minutes after nobody's playing it. */
export const DELETE: RequestHandler = async ({ url }) => {
	finishedWith(url.searchParams.get('copy') ?? '');
	return json({ ok: true });
};

export const POST: RequestHandler = async ({ request, url }) => {
	const body = await request.json().catch(() => null);
	const shareKey = typeof body?.share_key === 'string' ? body.share_key : '';
	const fid = Number(body?.fid);
	if (!shareKey || !fid || !downloadKindOf(shareKey)) return error(400, 'Not a copy that is downloaded ahead');
	const cookie = request.headers.get('cookie') ?? '';
	void prepare(url.origin, shareKey, fid, cookie);
	return json({ ok: true });
};

async function prepare(origin: string, shareKey: string, fid: number, cookie: string): Promise<void> {
	const ask = (path: string) => fetch(new URL(path, origin), { headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(120_000) });
	try {
		const stream = (await (await ask(`/api/watch/stream?share_key=${encodeURIComponent(shareKey)}&fid=${fid}`)).json()) as { url?: string };
		if (!stream.url) return;
		let playlist = stream.url;
		let text = await (await ask(playlist)).text();
		// A choice of qualities: the one the player picks (the highest H.264 one).
		if (!text.includes('#EXTINF')) {
			const lines = text.split('\n');
			let best: { address: string; bandwidth: number } | null = null;
			for (let i = 0; i < lines.length; i++) {
				const info = lines[i];
				if (!info.startsWith('#EXT-X-STREAM-INF')) continue;
				const codecs = /CODECS="([^"]*)"/.exec(info)?.[1] ?? '';
				if (codecs && !/avc1/.test(codecs)) continue;
				const bandwidth = Number(/BANDWIDTH=(\d+)/.exec(info)?.[1] ?? 0);
				const address = lines.slice(i + 1).find((l) => l.trim() && !l.startsWith('#'))?.trim();
				if (address && (!best || bandwidth > best.bandwidth)) best = { address, bandwidth };
			}
			if (!best) return;
			playlist = best.address;
			text = await (await ask(playlist)).text();
		}
		const copy = new URL(playlist, origin).searchParams.get('copy');
		if (copy && text.includes('#EXTINF')) downloadAhead(copy);
	} catch {
		// Not now: the episode plays the usual way when it comes.
	}
}
