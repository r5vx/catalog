import { error } from '@sveltejs/kit';
import { isAniwaveVideo, VIDEO_HEADERS } from '$lib/server/sources/aniwave';
import type { RequestHandler } from './$types';

/** The relay address for a file on another source's video server. */
const relayed = (url: string) => `/api/watch/relay?u=${encodeURIComponent(url)}`;

/**
 * Passes another source's video (Aniwave) on to the player. Its servers only answer their own
 * player and won't let another page read the video, so Catalog's server asks for it and hands
 * it over: playlists with every address inside pointed back here, video pieces as they come.
 * Only the servers Aniwave sent us to are fetched from.
 */
export const GET: RequestHandler = async ({ url, request }) => {
	let target: URL;
	try {
		target = new URL(url.searchParams.get('u') ?? '');
	} catch {
		return error(400, 'Bad address');
	}
	if (!isAniwaveVideo(target)) return error(403, 'Not a video server Catalog was sent to');

	const range = request.headers.get('range');
	let upstream: Response;
	try {
		upstream = await fetch(target, {
			headers: { ...VIDEO_HEADERS, ...(range ? { Range: range } : {}) },
			signal: AbortSignal.timeout(30000)
		});
	} catch {
		return error(502, 'The video server did not answer');
	}
	if (!upstream.ok) return error(upstream.status, 'The video server refused');

	// Aniwave's servers label video pieces as pictures; they're plain video.
	const type = (upstream.headers.get('content-type') ?? '').replace(/^image\/.*/i, 'video/mp2t');
	const headers = new Headers({ 'Content-Type': type || 'video/mp2t', 'Cache-Control': 'no-store' });
	for (const name of ['content-length', 'content-range', 'accept-ranges']) {
		const value = upstream.headers.get(name);
		if (value) headers.set(name, value);
	}

	// Labels can't be trusted (playlists come labelled as video, video as pictures), so the
	// first bytes say which it is. Video streams straight on; a playlist is read whole.
	const reader = upstream.body!.getReader();
	const first = await reader.read();
	const opening = first.value ?? new Uint8Array();
	if (!new TextDecoder().decode(opening.subarray(0, 16)).startsWith('#EXTM3U')) {
		const rest = new ReadableStream<Uint8Array>({
			start(controller) {
				if (!first.done) controller.enqueue(opening);
				else controller.close();
			},
			async pull(controller) {
				const { value, done } = await reader.read();
				if (done) controller.close();
				else controller.enqueue(value);
			},
			cancel() {
				reader.cancel().catch(() => {});
			}
		});
		return new Response(rest, { status: upstream.status, headers });
	}
	const parts = [opening];
	for (let r = first; !r.done; ) {
		r = await reader.read();
		if (r.value) parts.push(r.value);
	}

	// A playlist: every address in it pointed back here.
	const text = Buffer.concat(parts).toString('utf8');
	const pointed = text
		.split('\n')
		.map((line) => {
			const trimmed = line.trim();
			if (!trimmed) return line;
			// Addresses inside tags: URI="…" (encryption keys, audio tracks, init pieces).
			if (trimmed.startsWith('#')) {
				return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${relayed(new URL(uri, target).href)}"`);
			}
			return relayed(new URL(trimmed, target).href);
		})
		.join('\n');
	return new Response(pointed, {
		headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' }
	});
};
