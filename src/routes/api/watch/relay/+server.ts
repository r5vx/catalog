import { error } from '@sveltejs/kit';
import { isAniwaveVideo, VIDEO_HEADERS } from '$lib/server/sources/aniwave';
import { isVidriftVideo, playsDirect, VIDRIFT_HEADERS } from '$lib/server/sources/vidrift';
import { liveHeadersFor, trustVideoHost, trustedVideoHost } from '$lib/server/relayHosts';
import { fetchSteadily, piecePart, splitLongPieces } from '$lib/server/relayPieces';
import { MOVY_HEADERS } from '$lib/server/sources/movy';
import { isNotedPiece, notePieces, pieceAhead } from '$lib/server/relayReadAhead';
import { downloadKindOf, noteEpisode, storedPiece, wantedPiece } from '$lib/server/episodeDownloads';
import { isPicture, videoFromPicture } from '$lib/server/pictureVideo';
import { sharedLivePiece } from '$lib/server/liveShare';
import { repairFrameTimes } from '$lib/server/pieceRepair';
import { electronFetch } from '$lib/server/electron-fetch';

/** Video servers that only answer a browser (see below). */
const BROWSER_ONLY = /(^|\.)cdndirector\.dailymotion\.com$/;
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
	const askWith: Record<string, string> =
		kind === 'vidrift' ? VIDRIFT_HEADERS : kind === 'movy' ? MOVY_HEADERS : kind === 'live' ? liveHeadersFor(target) : VIDEO_HEADERS;
	// Which copy of which episode, and which piece of it (episodeDownloads.ts): 7Movies' and Movy's
	// episodes are downloaded ahead onto this computer, and kept by these rather than by address.
	const copy = url.searchParams.get('copy') ?? '';
	const pieceNumber = url.searchParams.has('n') ? Number(url.searchParams.get('n')) : null;
	const downloadedAhead = Boolean(copy && downloadKindOf(copy)) && pieceNumber !== null && Number.isInteger(pieceNumber);

	// One part of a long piece the playlist below split up (relayPieces.ts). (It takes the piece
	// from what's downloaded ahead when it's there.)
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
	// 7Movies' HEVC pieces have a frame on the keyframe's time, which can cost 2 s of picture
	// (pieceRepair.ts): mended on the way, whichever way the piece comes.
	const mended = (bytes: Uint8Array<ArrayBuffer>) => (kind === 'vidrift' && !range ? repairFrameTimes(bytes) : bytes);

	// A piece of an episode downloaded ahead: from this computer's disk, or as soon as it comes
	// (the one asked for goes first). The progress-bar pictures (`whole=1`) only take what's there.
	if (downloadedAhead && !range) {
		const stored = url.searchParams.has('whole') ? storedPiece(copy, pieceNumber!) : await wantedPiece(copy, pieceNumber!);
		if (stored) {
			const bytes = mended(new Uint8Array(stored));
			return new Response(bytes, {
				headers: { 'Content-Type': 'video/mp2t', 'Content-Length': String(bytes.length), 'Cache-Control': 'private, max-age=21600' }
			});
		}
	}

	// The video's pieces come fetched a few ahead (relayReadAhead.ts): three for Movy (slow per
	// download, at most five at once), six for 7Movies, two for Aniwave — for the video being
	// watched only. (7Movies' and Movy's servers take 20 s to 4 minutes over a piece they haven't
	// got yet, 2026-10-24, and asking again alongside only gets the same slow fetch; pieces asked
	// for earlier are simply under way sooner, more of them at once. Movy stays at three: it
	// refuses a sixth download, and the progress-bar pictures can take one.)
	// The progress-bar pictures' pieces (`whole=1`) set off more downloads each, past the five
	// Movy allows at once, and the video's were refused.
	const background = url.searchParams.has('whole');
	if (!range && !background && isNotedPiece(target.href)) {
		const ahead = await pieceAhead(target.href, askWith, kind === 'movy' ? 3 : kind === 'vidrift' ? 6 : 2);
		if (ahead) {
			const bytes = mended(new Uint8Array(ahead));
			return new Response(bytes, {
				headers: { 'Content-Type': 'video/mp2t', 'Content-Length': String(bytes.length), 'Cache-Control': 'private, max-age=21600' }
			});
		}
	}

	// Live TV (and replays): each piece fetched once for every screen watching (liveShare.ts).
	// Not playlists: they're read below (Dailymotion's first only through the app's browser).
	if (kind === 'live' && !range && !target.pathname.endsWith('.m3u8')) {
		const piece = await sharedLivePiece(target.href, askWith);
		if (piece !== 'playlist' && 'refused' in piece) return error(piece.refused, 'The video server refused');
		if (piece !== 'playlist') {
			return new Response(new Uint8Array(piece.bytes), {
				headers: { 'Content-Type': piece.type, 'Content-Length': String(piece.bytes.length), 'Cache-Control': 'private, max-age=3600' }
			});
		}
	}

	// Hosts that turn Node's own requests away (Dailymotion's first playlist: 403 whatever the
	// headers, 2026-10-25, while a browser gets it): asked through the desktop app's browser.
	if (BROWSER_ONLY.test(target.host) && !range) {
		const answer = await electronFetch(target.href, { headers: askWith });
		if (answer.status === 200 && answer.body.startsWith('#EXTM3U')) return servePlaylist(answer.body);
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
	// Live TV's pieces are pictures with the video inside (pictureVideo.ts): read whole, unwrapped.
	if (kind === 'live' && isPicture(opening)) {
		const whole = [opening];
		try {
			for (let r = first; !r.done; ) {
				r = await upstream.read();
				if (r.value) whole.push(r.value);
			}
		} catch {
			return error(502, 'The video server stopped answering');
		}
		const video = videoFromPicture(Buffer.concat(whole));
		if (!video) return error(502, 'Not a picture with video in it');
		return new Response(new Uint8Array(video), {
			headers: { 'Content-Type': 'video/mp2t', 'Content-Length': String(video.length), 'Cache-Control': 'private, max-age=3600' }
		});
	}
	// A 7Movies MP4 piece is read whole, to be mended (pieceRepair.ts).
	const mp4 = ['styp', 'moof', 'ftyp'].includes(new TextDecoder().decode(opening.subarray(4, 8)));
	if (kind === 'vidrift' && mp4 && !range) {
		const whole = [opening];
		try {
			for (let r = first; !r.done; ) {
				r = await upstream.read();
				if (r.value) whole.push(r.value);
			}
		} catch {
			return error(502, 'The video server stopped answering');
		}
		const bytes = mended(new Uint8Array(Buffer.concat(whole)));
		headers.set('content-length', String(bytes.length));
		return new Response(bytes, { status: response.status, headers });
	}
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

	return servePlaylist(Buffer.concat(parts).toString('utf8'));

		// A playlist: every address in it pointed back here — except video servers that let any
		// page play their pieces (7Movies' Orion), which the player fetches itself. Unless the copy
		// is downloaded ahead (Orion too, since 2026-10-25: fast here doesn't mean fast on mom's TV),
		// when its pieces come from here, off the disk once they're there.
	async function servePlaylist(text: string): Promise<Response> {
		const direct = (full: URL) => playsDirect(full) && !(copy && downloadKindOf(copy));
		const point = (address: string) => {
			const full = new URL(address, target);
			if (direct(full)) return full.href;
			// A server this playlist names is one the source sent us to as well.
			trustVideoHost(full, kind!);
			// The progress-bar pictures' playlists keep saying so, down to each piece. 7Movies'
			// pieces carry which mend they had (pieceRepair.ts), so a browser never plays one it
			// kept from a build that mended them wrongly.
			return relayed(full.href) + (kind === 'vidrift' ? '&mend=2' : '') + (background ? '&whole=1' : '');
		};
		// The copy's name goes on down: each quality's playlist is "<copy>~v<n>" (each sound track
		// "~a<n>"), and each piece carries its number.
		const media = text.includes('#EXTINF');
		const pieceUrls = media ? text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => new URL(l, target).href) : [];
		const numbers = new Map(pieceUrls.map((piece, n) => [piece, n]));
		const named = (address: string, which: string) => (copy && !direct(new URL(address, target)) ? `${point(address)}&copy=${encodeURIComponent(which)}` : point(address));
		const pointPiece = (address: string) => {
			const full = new URL(address, target).href;
			const n = numbers.get(full);
			return copy && n !== undefined && !direct(new URL(full)) ? `${point(full)}&copy=${encodeURIComponent(copy)}&n=${n}` : point(full);
		};
		if (copy && media && !background) noteEpisode(copy, pieceUrls, askWith);
		let variants = 0;
		let tracks = 0;
		// Very long pieces are listed as short parts (relayPieces.ts says why) — except for the
		// progress-bar pictures (?whole=1), which only want each piece's first picture.
		const split = background ? async (lines: string[]) => lines : splitLongPieces;
		const lines = await split(text.split('\n'), target, askWith, (address) => {
			const full = new URL(address);
			return direct(full) ? null : pointPiece(address);
		});
		// A playlist of pieces: their order, so the next ones can be fetched ahead.
		if (!background && text.includes('#EXTINF')) {
			notePieces(text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => new URL(l, target).href));
		}
		const pointed = lines
			.map((line) => {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith('/api/watch/relay?')) return line;
				// Addresses inside tags: URI="…" (encryption keys, audio tracks, init pieces).
				if (trimmed.startsWith('#')) {
					const audio = trimmed.startsWith('#EXT-X-MEDIA') && /TYPE=AUDIO/.test(trimmed);
					return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${audio ? named(uri, `${copy}~a${tracks++}`) : point(uri)}"`);
				}
				return media ? pointPiece(trimmed) : named(trimmed, `${copy}~v${variants++}`);
			})
			.join('\n');
		return new Response(pointed, {
			headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' }
		});
	}
};
