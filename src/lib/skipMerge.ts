/**
 * An episode's intro, recap and credits: the databases' (AniSkip, Anime Skip, IntroDB, from
 * /api/watch/skip-times) together with what Catalog found itself by comparing episodes' sound
 * (src/lib/skipFinder.ts, kept by /api/watch/skip-found). Shared by Catalog's player and the
 * Roku's (/api/roku/skips), so both skip the same parts.
 */
export type SkipSegment = { type: 'intro' | 'recap' | 'credits'; start: number; end: number; mixed?: boolean };

export function withFound(fromAniSkip: SkipSegment[], found: SkipSegment[]): SkipSegment[] {
	// This copy's own times, but a database's word that the story goes on over the song holds.
	const mixed = (f: SkipSegment) =>
		fromAniSkip.some((s) => s.mixed && s.type === f.type && s.start - 30 < f.end && f.start < s.end + 30);
	// Comparing two episodes finds only the part they share: Re:Zero S2E20's ending was found as
	// 28:26–28:53, while the song runs 27:59–29:27 (as Anime Skip says), 2026-10-24. A
	// database's span over most of a find (of a song's length, not some other cut's whole
	// episode) widens it.
	const overlap = (a: SkipSegment, b: SkipSegment) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
	const widened = (f: SkipSegment) => {
		const db = fromAniSkip.find((s) => s.type === f.type && s.end - s.start <= 240 && overlap(s, f) >= (f.end - f.start) / 2);
		return db ? { ...f, start: Math.min(f.start, db.start), end: Math.max(f.end, db.end) } : f;
	};
	const own = found.map(widened).map((f) => (mixed(f) ? { ...f, mixed: true } : f));
	const all = [...own, ...fromAniSkip.filter((s) => !found.some((f) => f.type === s.type))].sort((a, b) => a.start - b.start);
	return joinedOpening(all);
}

/**
 * The black credit roll seen in the preview pictures (creditRoll.ts, from `rollFrom` to the end)
 * as end credits: joined to credits found just before it (She-Hulk's animated credits run
 * straight into it), else a part of its own, so a scene between the two (She-Hulk E2's) is
 * never skipped. Credits already reaching the end from before it change nothing.
 */
export function withCreditRoll(segments: SkipSegment[], rollFrom: number | null, duration: number): SkipSegment[] {
	if (rollFrom === null || !(duration > rollFrom)) return segments;
	if (segments.some((s) => s.type === 'credits' && s.start <= rollFrom + 10 && s.end >= duration - 20)) return segments;
	const before = segments.find((s) => s.type === 'credits' && s.start < rollFrom && s.end >= rollFrom - 15 && s.end < duration - 20);
	if (before) return segments.map((s) => (s === before ? { ...s, end: duration } : s));
	return [...segments, { type: 'credits' as const, start: rollFrom, end: duration }].sort((a, b) => a.start - b.start);
}

/**
 * A recap and an intro that overlap or follow one another are one part, skipped with one
 * click: IntroDB had Chernobyl E2's recap as 0:00–0:58 and an intro inside it, 0:00–0:37, and
 * it took Skip Intro, then Skip Recap. (Not where the story goes on over either.)
 */
function joinedOpening(segments: SkipSegment[]): SkipSegment[] {
	const recap = segments.find((s) => s.type === 'recap' && !s.mixed);
	const intro = segments.find((s) => s.type === 'intro' && !s.mixed);
	if (!recap || !intro || recap.start > intro.end + 5 || intro.start > recap.end + 5) return segments;
	const first = recap.start <= intro.start ? recap : intro;
	const joined: SkipSegment = { type: first.type, start: Math.min(recap.start, intro.start), end: Math.max(recap.end, intro.end) };
	return [...segments.filter((s) => s !== recap && s !== intro), joined].sort((a, b) => a.start - b.start);
}
