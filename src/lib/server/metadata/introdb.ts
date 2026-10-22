/**
 * Intro, recap and credits from IntroDB (introdb.app): a free community database for TV
 * episodes, by IMDb id, season and episode, with no key. Unlike AniSkip and Anime Skip it has
 * Dungeon Meshi, and most of Bleach, and plenty of non-anime shows too.
 *
 * It doesn't say which cut its times are for, so they come last (after AniSkip's and Anime Skip's,
 * which do), and Catalog's own times for the copy playing, found by comparing sound, replace them
 * (src/lib/skipFinder.ts). Dungeon Meshi E4: IntroDB 0:01–1:31 and 24:16–25:47; Catalog found
 * 0:01–1:31 and 24:15–25:47 on 7Movies' copy.
 */
import { getOrderCache, saveOrderCache } from '../db/queries';
import { tmdbShow } from '../combinedEpisodes';
import { tmdbGet } from './tmdb';
import type { SkipSegment } from './skiptimes';

const API = 'https://api.introdb.app/segments';
const HOUR = 60 * 60 * 1000;

type Part = { start_sec: number | null; end_sec: number | null } | null;
type Answer = { intro?: Part; recap?: Part; outro?: Part };

/** The show's IMDb id, through TMDB (kept a month; '' when it has none). */
async function imdbIdOf(title: string): Promise<string | null> {
	const key = `imdb-id|${title.toLowerCase()}`;
	const kept = getOrderCache(key);
	if (kept && Date.now() - kept.at < 30 * 24 * HOUR) return kept.value as string;
	const show = await tmdbShow(title, '').catch(() => null);
	if (!show) return null;
	const ids = await tmdbGet<{ imdb_id?: string | null }>(`/tv/${show.id}/external_ids`);
	if (!ids) return null;
	const id = ids.imdb_id ?? '';
	saveOrderCache(key, id, Date.now());
	return id;
}

/** One episode's parts (kept a day, or 6 hours when IntroDB has none yet). */
export async function introDbTimes(title: string, season: number, episode: number, duration: number): Promise<SkipSegment[]> {
	if (!season || !episode) return [];
	const imdb = await imdbIdOf(title);
	if (!imdb) return [];
	const key = `introdb|${imdb}|${season}|${episode}`;
	const kept = getOrderCache(key);
	let answer = kept?.value as Answer | null | undefined;
	const fresh = kept && Date.now() - kept.at < (answer ? 24 : 6) * HOUR;
	if (!fresh) {
		try {
			const resp = await fetch(`${API}?imdb_id=${imdb}&season=${season}&episode=${episode}`, { signal: AbortSignal.timeout(8000) });
			if (resp.ok) answer = (await resp.json()) as Answer;
			else if (resp.status === 404) answer = null;
			if (resp.ok || resp.status === 404) saveOrderCache(key, answer ?? null, Date.now());
		} catch {
			// Not answering: what was kept, if anything.
		}
	}
	if (!answer) return [];

	const segments: SkipSegment[] = [];
	for (const [type, part] of [['intro', answer.intro], ['recap', answer.recap], ['credits', answer.outro]] as const) {
		const start = part?.start_sec ?? (part?.end_sec ? 0 : null);
		const end = part?.end_sec ?? null;
		// Sensible for this file: a part of 5 s or more, inside it.
		if (start === null || end === null || end - start < 5 || end > duration + 5) continue;
		segments.push({ type, start, end: Math.min(end, duration) });
	}
	return segments;
}
