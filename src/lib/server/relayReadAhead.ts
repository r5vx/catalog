/**
 * Fetching the next few video pieces before the player asks, for video servers that are slow
 * per download but fine with several at once.
 *
 * Movy's server (2026-10-17) sends each download at about 2 Mbps — a 1080p piece (5 s, ~1.7 MB)
 * took 5–8 s, so the player, which asks for one piece at a time, kept falling behind. Six at
 * once arrived together in 8.5 s, but a sixth was refused (a 38-byte reply), so: while a piece
 * is fetched, the next three are too (four at once), and they wait here until asked for.
 *
 * The relay notes each playlist's pieces in order (`notePieces`) so the next ones are known.
 */
import { fetchSteadily } from './relayPieces';

const AHEAD = 3;
const KEEP_MS = 3 * 60 * 1000;

/** For each piece: the playlist's pieces and where it is among them. */
const order = new Map<string, { pieces: string[]; at: number }>();
const fetched = new Map<string, { at: number; bytes: Promise<Buffer | null> }>();

export function notePieces(pieces: string[]): void {
	pieces.forEach((url, at) => order.set(url, { pieces, at }));
}

/** Whether an address is a video piece from a playlist the relay has seen. */
export const isNotedPiece = (url: string) => order.has(url);

/** A whole piece, or null if the server didn't send one (refused, cut short, or an error page). */
async function fetchPiece(url: string, headers: Record<string, string>): Promise<Buffer | null> {
	try {
		const answer = await fetchSteadily(url, headers);
		if (!answer.response.ok) {
			answer.cancel();
			return null;
		}
		const parts: Uint8Array[] = [];
		for (let r = await answer.read(); !r.done; r = await answer.read()) parts.push(r.value);
		const bytes = Buffer.concat(parts);
		// A refusal comes back as a tiny reply rather than an error.
		return bytes.length > 1000 ? bytes : null;
	} catch {
		return null;
	}
}

function forgetOld() {
	const now = Date.now();
	for (const [url, entry] of fetched) if (now - entry.at > KEEP_MS) fetched.delete(url);
}

/**
 * A piece: the one fetched ahead if there is one, else fetched now — and the next few started.
 * Null when it couldn't be had (the relay then asks the plain way).
 */
export async function pieceAhead(url: string, headers: Record<string, string>): Promise<Buffer | null> {
	forgetOld();
	let entry = fetched.get(url);
	if (!entry) {
		entry = { at: Date.now(), bytes: fetchPiece(url, headers) };
		fetched.set(url, entry);
	}
	const place = order.get(url);
	if (place) {
		for (const next of place.pieces.slice(place.at + 1, place.at + 1 + AHEAD)) {
			if (!fetched.has(next)) fetched.set(next, { at: Date.now(), bytes: fetchPiece(next, headers) });
		}
	}
	const bytes = await entry.bytes;
	// Handed over once; a failed one is forgotten so it's asked again.
	fetched.delete(url);
	return bytes;
}
