/**
 * Which sources said they haven't got a title, so their copies aren't listed for it (owner,
 * 2026-11-15: "why even show them if they will fail instantly"). 7Movies, Movy and Vidfast are
 * listed for every film and episode by its TMDB id without being asked; picked, a missing one
 * fails at once. Silver Fang Legend Weed listed all three, and only Aniwave had it.
 *
 * Only real answers count, kept in the library:
 *   - Movy and Vidfast: every one of their servers said no (`error === 'none'`; a time-out or a
 *     lookup called off isn't an answer). Two days: a source may get a title later.
 *   - 7Movies: its site answered but had nothing that plays. Six hours only, as its answers can
 *     be a passing fault (a 502 for an SVU episode it had, 2026-11-14).
 * Episode answers apply only to that episode, including the pilot. A "yes" clears a miss.
 */
import { getOrderCache, saveOrderCache } from './db/queries';

type What = { type: 'tv' | 'movie'; id: number; season?: number; episode?: number };

const HOUR = 60 * 60 * 1000;
const KEPT: Record<string, number> = { '7Movies': 6 * HOUR, Movy: 48 * HOUR, Vidfast: 48 * HOUR };
const keyOf = (source: string, what: string) => `source-answer|${source}|${what}`;

const mediaKey = (w: What) => w.type === 'movie' ? `movie:${w.id}` : `tv:${w.id}:${w.season ?? 1}:${w.episode ?? 1}`;

/** A real answer from `source` about a film or an episode. */
export function noteSourceAnswer(source: string, what: What, yes: boolean): void {
	try {
		saveOrderCache(keyOf(source, mediaKey(what)), yes, Date.now());
	} catch {}
}

function saidNo(source: string, key: string): boolean {
	const kept = getOrderCache(keyOf(source, key));
	return Boolean(kept && kept.value === false && Date.now() - kept.at < (KEPT[source] ?? 6 * HOUR));
}

/** Whether `source` said lately that it hasn't got this exact film or episode. */
export function sourceHasNot(source: string, what: What): boolean {
	try {
		return saidNo(source, mediaKey(what));
	} catch {
		return false;
	}
}
