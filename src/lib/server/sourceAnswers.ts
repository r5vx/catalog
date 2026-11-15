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
 * A film's answer is the film's. For a show, the first episode's answer (what the Watch check
 * asks) counts for the whole show; any other episode's only for itself. A "yes" clears it.
 */
import { getOrderCache, saveOrderCache } from './db/queries';

type What = { type: 'tv' | 'movie'; id: number; season?: number; episode?: number };

const HOUR = 60 * 60 * 1000;
const KEPT: Record<string, number> = { '7Movies': 6 * HOUR, Movy: 48 * HOUR, Vidfast: 48 * HOUR };
const keyOf = (source: string, what: string) => `source-answer|${source}|${what}`;

/** "movie:550"; a show's episode "tv:1396:2:5", and its first episode also "tv:1396" (the whole show). */
function keysOf(what: What): string[] {
	if (what.type === 'movie') return [`movie:${what.id}`];
	const season = what.season || 1;
	const episode = what.episode || 1;
	const keys = [`tv:${what.id}:${season}:${episode}`];
	if (season === 1 && episode === 1) keys.push(`tv:${what.id}`);
	return keys;
}

/** A real answer from `source` about a film or an episode. */
export function noteSourceAnswer(source: string, what: What, yes: boolean): void {
	try {
		for (const key of keysOf(what)) saveOrderCache(keyOf(source, key), yes, Date.now());
		// A "yes" for any episode means the show is there: its "no" goes.
		if (yes && what.type === 'tv') saveOrderCache(keyOf(source, `tv:${what.id}`), true, Date.now());
	} catch {}
}

function saidNo(source: string, key: string): boolean {
	const kept = getOrderCache(keyOf(source, key));
	return Boolean(kept && kept.value === false && Date.now() - kept.at < (KEPT[source] ?? 6 * HOUR));
}

/** Whether `source` said lately that it hasn't got this film or episode (or the whole show). */
export function sourceHasNot(source: string, what: What): boolean {
	try {
		if (what.type === 'movie') return saidNo(source, `movie:${what.id}`);
		return saidNo(source, `tv:${what.id}`) || saidNo(source, `tv:${what.id}:${what.season || 1}:${what.episode || 1}`);
	} catch {
		return false;
	}
}
