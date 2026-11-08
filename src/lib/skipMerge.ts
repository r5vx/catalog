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
	// The databases' times win (the owner, 2026-10-31: trust the skip sites; the ones known to be
	// wrong, like Chernobyl's, are left out where they're read). A found part is used only where
	// no database part of its kind is within a minute: another part altogether (Hawkeye S1E1's
	// Marvel logo at 0:01, with IntroDB's intro at 7:01), or a kind the databases don't have.
	const SAME_PART = 60;
	const near = (a: SkipSegment, b: SkipSegment) => a.start - SAME_PART < b.end && b.start - SAME_PART < a.end;
	const own = found
		.filter((f) => !fromAniSkip.some((s) => s.type === f.type && near(f, s)))
		.map((f) => (mixed(f) ? { ...f, mixed: true } : f));
	// A recap and an intro back to back stay two skips (the owner, 2026-10-31: someone may want to
	// skip the recap but watch the intro). They were joined into one from 2026-10-28.
	return closeOpeningGaps([...fromAniSkip, ...own].sort((a, b) => a.start - b.start));
}

/**
 * An intro and a recap a few seconds apart: the seconds between go to the recap, so Skip Recap
 * is there the moment Skip Intro lands. Hawkeye S1E5 (2026-11-02): IntroDB's intro ends at 5:26
 * and its recap starts at 5:35, but the "previously on" lines start at 5:23, so the player showed
 * 9 s of recap as if it were story. Still two skips.
 */
const OPENING_GAP = 15;
function closeOpeningGaps(segments: SkipSegment[]): SkipSegment[] {
	const out = segments.map((s) => ({ ...s }));
	for (let i = 0; i + 1 < out.length; i++) {
		const [a, b] = [out[i], out[i + 1]];
		const gap = b.start - a.end;
		if (!(gap > 0 && gap <= OPENING_GAP)) continue;
		if (a.type === 'intro' && b.type === 'recap') b.start = a.end;
		else if (a.type === 'recap' && b.type === 'intro') a.end = b.start;
	}
	return out;
}

/**
 * The black credit roll seen in the preview pictures (creditRoll.ts, from `rollFrom` to the end)
 * as end credits: joined to credits found just before it (She-Hulk's animated credits run
 * straight into it), else a part of its own, so a scene between the two (She-Hulk E2's) is
 * never skipped. Credits already reaching the end from before it change nothing.
 */
export function withCreditRoll(segments: SkipSegment[], rollFrom: number | null, duration: number): SkipSegment[] {
	if (rollFrom === null || !(duration > rollFrom)) return segments;
	// Credits already running to the end (a skip site's, mostly) win, wherever they start: Hawkeye
	// S1E1's dark last scene looked like a roll from 43:35, and IntroDB's credits (44:51, right)
	// got an earlier second part, so Next Episode came 75 s early (2026-10-31).
	if (segments.some((s) => s.type === 'credits' && s.end >= duration - 20)) return segments;
	const before = segments.find((s) => s.type === 'credits' && s.start < rollFrom && s.end >= rollFrom - 15 && s.end < duration - 20);
	if (before) return segments.map((s) => (s === before ? { ...s, end: duration } : s));
	return [...segments, { type: 'credits' as const, start: rollFrom, end: duration }].sort((a, b) => a.start - b.start);
}
