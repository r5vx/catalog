import { error } from '@sveltejs/kit';
import { bifOf } from '$lib/server/bif';
import { stripFor } from '$lib/server/previewStrips';
import type { RequestHandler } from './$types';

/** Each copy's length in seconds, once read (by "share|fid"). */
const lengths = new Map<string, number>();

/** A playlist's length in seconds (its first quality's pieces added up); 0 if it can't be read. */
async function playlistLength(address: string, headers: Record<string, string>): Promise<number> {
	const read = async (at: string) => {
		const resp = await fetch(at, { headers, signal: AbortSignal.timeout(10_000) });
		return resp.ok ? resp.text() : '';
	};
	try {
		let list = await read(address);
		const variant = /#EXT-X-STREAM-INF[^\n]*\n([^#\s][^\n]*)/.exec(list)?.[1]?.trim();
		if (variant) list = await read(new URL(variant, address).href);
		return [...list.matchAll(/#EXTINF:([\d.]+)/g)].reduce((total, m) => total + Number(m[1]), 0);
	} catch {
		return 0;
	}
}

/**
 * The Roku's preview pictures for a video (src/lib/server/bif.ts), from the ones the computer
 * keeps: ?title=&type=&season=&episode=&fid=&share= (the copy playing: the pictures are kept by
 * its length, which says which cut it is, read here from its playlist so the Roku's start isn't
 * held up). 404 until enough pictures are kept; /api/roku/play asks the computer to make them.
 */
export const GET: RequestHandler = async ({ url, request }) => {
	const title = url.searchParams.get('title')?.trim() ?? '';
	const type = url.searchParams.get('type') === 'movie' ? 'movie' : 'tv';
	const season = Number(url.searchParams.get('season')) || 0;
	const episode = Number(url.searchParams.get('episode')) || 0;
	const fid = Number(url.searchParams.get('fid'));
	const share = url.searchParams.get('share') ?? '';
	if (!title || !share || !Number.isFinite(fid)) return error(400, 'Which video?');

	const copy = `${share}|${fid}`;
	let length = lengths.get(copy) ?? 0;
	if (!length) {
		// Asked of this same Catalog as the Roku (its PIN cookie), as /api/roku/play does.
		const forward: Record<string, string> = {};
		for (const name of ['cookie', 'user-agent']) {
			const value = request.headers.get(name);
			if (value) forward[name] = value;
		}
		const stream = await fetch(new URL(`/api/watch/stream?share_key=${encodeURIComponent(share)}&fid=${fid}`, url.origin), { headers: forward })
			.then((r) => (r.ok ? (r.json() as Promise<{ url?: string }>) : null))
			.catch(() => null);
		if (stream?.url) {
			const address = new URL(stream.url, url.origin);
			// Showbox's own video server wants Febbox's Referer.
			const headers = address.pathname.startsWith('/api/') ? forward : { ...forward, Referer: 'https://www.febbox.com/' };
			length = await playlistLength(address.href, headers);
		}
		if (length > 0) lengths.set(copy, length);
	}
	if (!(length > 0)) return error(404, "That video's length isn't known");
	const bif = bifOf(stripFor(title, type, season, episode, Math.round(length)).frames, length);
	if (!bif) return error(404, 'No preview pictures yet');
	return new Response(new Uint8Array(bif), {
		headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' }
	});
};
