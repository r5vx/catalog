/**
 * Intro, recap and credits from TheIntroDB (theintrodb.org): the second free community database
 * for TV episodes and films, no key (5,000 lookups a day per address). Unlike IntroDB it knows
 * which cut its times are for: told the copy's length, it answers for the version within 5
 * minutes of it, and says that version's length, so times for another cut are left out here.
 *
 * Each part comes with how many people sent it (`votes`): /api/watch/skip-times takes each part
 * from whichever of the two databases more people agree on.
 *
 * `otherCut`: the times people sent are for a version of another length, so they don't fit this
 * copy, and IntroDB's (which doesn't say) most likely don't either. Chernobyl E5 on 7Movies is
 * Sky's cut (68:40: Sky's logo, then new scenes); the databases' recap, 0:00–0:56, is HBO's (72:31),
 * which opens with clips of E4.
 */
import { getOrderCache, saveOrderCache } from '../db/queries';
import { imdbIdOf, isWrong } from './introdb';
import type { SkipSegment } from './skiptimes';

export type TheIntroDbAnswer = { segments: SkipSegment[]; otherCut: boolean };

const API = 'https://api.theintrodb.org/v4/media';
const HOUR = 60 * 60 * 1000;
/** The version answered for may be this much longer or shorter than the copy playing. */
const SAME_CUT = 20;

type Part = { start_ms: number | null; end_ms: number | null; submission_count?: number };
type Answer = { group_duration_ms?: number; intro?: Part[]; recap?: Part[]; credits?: Part[] };

/** One episode's parts (kept a day, or 6 hours when it has none yet). */
export async function theIntroDbTimes(title: string, season: number, episode: number, duration: number): Promise<TheIntroDbAnswer> {
	const none: TheIntroDbAnswer = { segments: [], otherCut: false };
	if (!season || !episode || !(duration > 60)) return none;
	const imdb = await imdbIdOf(title);
	if (!imdb) return none;
	const key = `theintrodb|${imdb}|${season}|${episode}|${Math.round(duration / 60)}`;
	const kept = getOrderCache(key);
	let answer = kept?.value as Answer | null | undefined;
	const fresh = kept && Date.now() - kept.at < (answer ? 24 : 6) * HOUR;
	if (!fresh) {
		try {
			const params = new URLSearchParams({ imdb_id: imdb, season: String(season), episode: String(episode), duration_ms: String(Math.round(duration * 1000)), details: 'true' });
			const resp = await fetch(`${API}?${params}`, { signal: AbortSignal.timeout(8000) });
			if (resp.ok) answer = (await resp.json()) as Answer;
			else if (resp.status === 404) answer = null;
			if (resp.ok || resp.status === 404) saveOrderCache(key, answer ?? null, Date.now());
		} catch {
			// Not answering: what was kept, if anything.
		}
	}
	if (!answer) return none;
	// Times for another cut don't fit this copy.
	if (answer.group_duration_ms && Math.abs(answer.group_duration_ms / 1000 - duration) > SAME_CUT) return { segments: [], otherCut: true };

	const segments: SkipSegment[] = [];
	for (const type of ['intro', 'recap', 'credits'] as const) {
		// Several of a kind: the one most people sent.
		const part = [...(answer[type] ?? [])].sort((a, b) => (b.submission_count ?? 0) - (a.submission_count ?? 0))[0];
		if (!part || (part.start_ms === null && part.end_ms === null)) continue;
		const start = (part.start_ms ?? 0) / 1000;
		// Credits with no end run to the end of the video.
		const end = part.end_ms === null ? duration : part.end_ms / 1000;
		if (end - start < 5 || end > duration + 5 || isWrong(imdb, season, type)) continue;
		segments.push({ type, start, end: Math.min(end, duration), votes: part.submission_count ?? 1 });
	}
	return { segments, otherCut: false };
}
