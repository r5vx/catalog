import { fetchSteadily } from '$lib/server/relayPieces';
import { isPicture, videoFromPicture } from '$lib/server/pictureVideo';

/*
 * Live TV on several screens at once (mom's house: four or more TVs on one game). Each screen
 * asked the channel's server for every piece itself, so five TVs on the Super Bowl were five
 * downloads of each piece over one home connection, from a site at its busiest. Now a piece is
 * fetched once, and every screen that asks for it while it comes, or within a minute after, gets
 * the same bytes (the relay, `kind === 'live'`). The channel's playlist is shared the same way
 * (/api/live/playlist), which is also what makes the screens ask for the same pieces.
 */

export type LivePiece = { bytes: Uint8Array; type: string };
/** The server's refusal (its status; 502 when it didn't answer). */
type Refused = { refused: number };

/** Kept this long after it came: screens a few pieces apart still share. */
const KEEP_MS = 60_000;
/** At most this much kept (about a minute of three channels in 1080p). */
const MAX_BYTES = 250 * 1024 * 1024;

type Kept = { at: number; size: number; piece: Promise<LivePiece | 'playlist' | Refused> };
const kept = new Map<string, Kept>();
let keptBytes = 0;

/*
 * A piece's address with its sign-in left out. Some live servers sign every playlist afresh, so
 * the same piece comes under another token a few seconds later; the rest of the address still
 * says which piece it is. (Two pieces only told apart by a token would be a server that doesn't
 * name its pieces; none seen. Unmatched addresses just aren't shared.)
 */
const SIGNING = /^(token|t|e|exp|expires|x-expires|x-signature|signature|sig|hash|refresh_token|hmac|auth|md5|st|policy|key-pair-id)$/i;
function pieceKey(address: string): string {
	const url = new URL(address);
	for (const name of [...url.searchParams.keys()]) if (SIGNING.test(name)) url.searchParams.delete(name);
	return url.href;
}

/**
 * The live piece at `address`, fetched once however many screens ask. 'playlist' when the address
 * turned out to be a playlist (the relay handles those itself); `refused` when the server didn't give
 * it, with its status (not kept, so the next ask tries again).
 */
export function sharedLivePiece(address: string, headers: Record<string, string>): Promise<LivePiece | 'playlist' | Refused> {
	forgetOld();
	const key = pieceKey(address);
	const already = kept.get(key);
	if (already) return already.piece;
	const entry: Kept = { at: Date.now(), size: 0, piece: wholePiece(address, headers) };
	kept.set(key, entry);
	entry.piece.then((piece) => {
		if (kept.get(key) !== entry) return;
		if (piece === 'playlist' || 'refused' in piece) {
			kept.delete(key);
			return;
		}
		entry.at = Date.now();
		entry.size = piece.bytes.length;
		keptBytes += entry.size;
		forgetOld();
	});
	return entry.piece;
}

/** Pieces past their minute, then the oldest while there's too much. */
function forgetOld() {
	const now = Date.now();
	for (const [key, entry] of kept) {
		if (!entry.size) continue; // still coming
		if (now - entry.at < KEEP_MS && keptBytes <= MAX_BYTES) continue;
		kept.delete(key);
		keptBytes -= entry.size;
	}
}

async function wholePiece(address: string, headers: Record<string, string>): Promise<LivePiece | 'playlist' | Refused> {
	let upstream: Awaited<ReturnType<typeof fetchSteadily>>;
	try {
		upstream = await fetchSteadily(address, headers);
	} catch {
		return { refused: 502 };
	}
	if (!upstream.response.ok) {
		upstream.cancel();
		return { refused: upstream.response.status };
	}
	const parts: Uint8Array[] = [];
	try {
		for (let r = await upstream.read(); !r.done; r = await upstream.read()) if (r.value) parts.push(r.value);
	} catch {
		return { refused: 502 };
	}
	const bytes = Buffer.concat(parts);
	if (new TextDecoder().decode(bytes.subarray(0, 16)).startsWith('#EXTM3U')) return 'playlist';
	// Pieces that are pictures with the video inside (pictureVideo.ts), unwrapped.
	if (isPicture(bytes)) {
		const video = videoFromPicture(bytes);
		return video ? { bytes: new Uint8Array(video), type: 'video/mp2t' } : { refused: 502 };
	}
	// Labels can't be trusted (video comes labelled as pictures or web pages).
	const type = (upstream.response.headers.get('content-type') ?? '').replace(/^(image\/|text\/html).*/i, 'video/mp2t');
	return { bytes: new Uint8Array(bytes), type: type || 'video/mp2t' };
}
