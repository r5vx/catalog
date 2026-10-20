/**
 * Every time a video stops to load, what was going on — so the next time it happens there are
 * numbers instead of guesses (2026-10-19: the owner and mom both buffered at 7–8 pm, on Showbox
 * and 7Movies, and an hour later everything measured fast).
 *
 * The player sends what it saw (each piece's speed and server, how much it had loaded ahead,
 * what else Catalog was downloading). This computer adds how fast it was getting the pieces it
 * passes on (7Movies, Aniwave, Movy), which a TV can't see: slow here means the site; fast here
 * but slow on the TV means the house's Wi-Fi between them.
 *
 * The last 100 stops are kept (in the library, beside other lookups), shown on Settings →
 * Playback and in /api/diagnostics.
 */
import { getOrderCache, saveOrderCache } from './db/queries';

const KEY = 'playback-log';
const KEEP = 100;

type RelayNote = { at: number; host: string; bytes: number; ms: number };
const relayNotes: RelayNote[] = [];

/** A piece this computer fetched to pass on: how big, how long. */
export function noteRelayPiece(url: string, bytes: number, ms: number): void {
	if (bytes < 1000 || ms <= 0) return;
	let host = '';
	try {
		host = new URL(url).host;
	} catch {}
	relayNotes.push({ at: Date.now(), host, bytes, ms });
	if (relayNotes.length > 200) relayNotes.splice(0, relayNotes.length - 200);
}

const mbps = (bytes: number, ms: number) => Math.round(((bytes * 8) / (ms / 1000) / 1e6) * 10) / 10;

/** How the computer's own downloads went in the last 90 s, by server. */
function relaySummary() {
	const since = Date.now() - 90_000;
	const recent = relayNotes.filter((n) => n.at >= since);
	const byHost = new Map<string, RelayNote[]>();
	for (const n of recent) byHost.set(n.host, [...(byHost.get(n.host) ?? []), n]);
	return [...byHost].map(([host, notes]) => ({
		host,
		pieces: notes.length,
		// Each piece's own speed, then the typical one: one download at a time is what can lag.
		mbpsEach: Math.round(notes.map((n) => mbps(n.bytes, n.ms)).sort((a, b) => a - b)[Math.floor(notes.length / 2)] * 10) / 10,
		slowestSeconds: Math.round(Math.max(...notes.map((n) => n.ms)) / 100) / 10
	}));
}

export type PlaybackStop = Record<string, unknown> & { at: string };

export function addPlaybackStop(seen: Record<string, unknown>): PlaybackStop {
	const stop: PlaybackStop = { ...seen, at: new Date().toISOString(), computer: relaySummary() };
	const kept = (getOrderCache(KEY)?.value as PlaybackStop[] | undefined) ?? [];
	saveOrderCache(KEY, [stop, ...kept].slice(0, KEEP), Date.now());
	return stop;
}

/** The stops kept, newest first. */
export function playbackStops(): PlaybackStop[] {
	return (getOrderCache(KEY)?.value as PlaybackStop[] | undefined) ?? [];
}
