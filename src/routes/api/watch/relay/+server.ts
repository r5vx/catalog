import { error } from '@sveltejs/kit';
import { isAniwaveVideo, VIDEO_HEADERS } from '$lib/server/sources/aniwave';
import { isVidriftVideo, playsDirect, VIDRIFT_HEADERS } from '$lib/server/sources/vidrift';
import { trustVideoHost, trustedVideoHost } from '$lib/server/relayHosts';
import { fetchSteadily, piecePart, splitLongPieces } from '$lib/server/relayPieces';
import { MOVY_HEADERS } from '$lib/server/sources/movy';
import { isNotedPiece, notePieces, pieceAhead } from '$lib/server/relayReadAhead';
import type { RequestHandler } from './$types';

/** The relay address for a file on another source's video server. */
const relayed = (url: string) => `/api/watch/relay?u=${encodeURIComponent(url)}`;

/**
 * Passes another source's video (Aniwave, 7Movies) on to the player. Its servers only answer their own
 * player and won't let another page read the video, so Catalog's server asks for it and hands
 * it over: playlists with every address inside pointed back here, video pieces as they come.
 * Only servers a source sent us to are fetched from (and the ones its playlists name).
 */
export const GET: RequestHandler = async ({ url, request }) => {
	let target: URL;
	try {
		target = new URL(url.searchParams.get('u') ?? '');
	} catch {
		return error(400, 'Bad address');
	}
	const kind = isVidriftVideo(target) ? 'vidrift' : isAniwaveVideo(target) ? 'aniwave' : trustedVideoHost(target);
	if (!kind) return error(403, 'Not a video server Catalog was sent to');
	const askWith: Record<string, string> = kind === 'vidrift' ? VIDRIFT_HEADERS : kind === 'movy' ? MOVY_HEADERS : VIDEO_HEADERS;

	// One part of a long piece the playlist below split up (relayPieces.ts).
	if (url.searchParams.has('part')) {
		const number = (name: string) => Number(url.searchParams.get(name));
		const bytes = await piecePart(target.href, askWith, {
			part: number('part'), of: number('of'), len: number('len'), timescale: number('ts'), track: number('tk')
		});
		if (!bytes) return error(502, 'The video server stopped answering');
		return new Response(new Uint8Array(bytes), {
			headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length), 'Cache-Control': 'private, max-age=21600' }
		});
	}

	const range = request.headers.get('range');

	// Movy's server is slow per download: its pieces come fetched a few ahead (relayReadAhead.ts).
	if (kind === 'movy' && !range && isNotedPiece(target.href)) {
		const bytes = await pieceAhead(target.href, askWith);
		if (bytes) {
			return new Response(new Uint8Array(bytes), {
				headers: { 'Content-Type': 'video/mp2t', 'Content-Length': String(bytes.length), 'Cache-Control': 'private, max-age=21600' }
			});
		}
	}

	let upstream: Awaited<ReturnType<typeof fetchSteadily>>;
	try {
		upstream = await fetchSteadily(target, { ...askWith, ...(range ? { Range: range } : {}) });
	} catch {
		return error(502, 'The video server did not answer');
	}
	const { response } = upstream;
	if (!response.ok) {
		upstream.cancel();
		return error(response.status, 'The video server refused');
	}

	// Aniwave's servers label video pieces as pictures, Movy's as web pages; they're plain video.
	const type = (response.headers.get('content-type') ?? '').replace(/^(image\/|text\/html).*/i, 'video/mp2t');
	// Video pieces may be kept by the browser for a few hours: the progress-bar pictures ask for
	// the same pieces the player already has, and get them without a second download. (Playlists
	// are answered further down, never kept: their links change.)
	const headers = new Headers({ 'Content-Type': type || 'video/mp2t', 'Cache-Control': 'private, max-age=21600' });
	for (const name of ['content-length', 'content-range', 'accept-ranges']) {
		const value = response.headers.get(name);
		if (value) headers.set(name, value);
	}

	// Labels can't be trusted (playlists come labelled as video, video as pictures), so the
	// first bytes say which it is. Video streams straight on; a playlist is read whole.
	let first: ReadableStreamReadResult<Uint8Array>;
	try {
		first = await upstream.read();
	} catch {
		return error(502, 'The video server stopped answering');
	}
	const opening = first.value ?? new Uint8Array();
	if (!new TextDecoder().decode(opening.subarray(0, 16)).startsWith('#EXTM3U')) {
		const rest = new ReadableStream<Uint8Array>({
			start(controller) {
				if (!first.done) controller.enqueue(opening);
				else controller.close();
			},
			async pull(controller) {
				try {
					const { value, done } = await upstream.read();
					if (done) controller.close();
					else controller.enqueue(value);
				} catch (e) {
					controller.error(e);
				}
			},
			cancel() {
				upstream.cancel();
			}
		});
		return new Response(rest, { status: response.status, headers });
	}
	const parts = [opening];
	try {
		for (let r = first; !r.done; ) {
			r = await upstream.read();
			if (r.value) parts.push(r.value);
		}
	} catch {
		return error(502, 'The video server stopped answering');
	}

	// A playlist: every address in it pointed back here — except video servers that let any
	// page play their pieces (7Movies' Orion), which the player fetches itself.
	const text = Buffer.concat(parts).toString('utf8');
	const point = (address: string) => {
		const full = new URL(address, target);
		if (playsDirect(full)) return full.href;
		// A server this playlist names is one the source sent us to as well.
		trustVideoHost(full, kind);
		return relayed(full.href);
	};
	// Very long pieces are listed as short parts (relayPieces.ts says why) — except for the
	// progress-bar pictures (?whole=1), which only want each piece's first picture.
	const split = url.searchParams.has('whole') ? async (lines: string[]) => lines : splitLongPieces;
	const lines = await split(text.split('\n'), target, askWith, (address) => {
		const full = new URL(address);
		return playsDirect(full) ? null : point(address);
	});
	// A Movy playlist of pieces: their order, so the next ones can be fetched ahead.
	if (kind === 'movy' && text.includes('#EXTINF')) {
		notePieces(text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => new URL(l, target).href));
	}
	const pointed = lines
		.map((line) => {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('/api/watch/relay?')) return line;
			// Addresses inside tags: URI="…" (encryption keys, audio tracks, init pieces).
			if (trimmed.startsWith('#')) {
				return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${point(uri)}"`);
			}
			return point(trimmed);
		})
		.join('\n');
	return new Response(pointed, {
		headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' }
	});
};
