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
	return [...own, ...fromAniSkip.filter((s) => !found.some((f) => f.type === s.type))].sort((a, b) => a.start - b.start);
}
