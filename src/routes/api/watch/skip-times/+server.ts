import { json, error } from '@sveltejs/kit';
import { skipTimesFor, type SkipSegment } from '$lib/server/metadata/skiptimes';
import { animeSkipTimes, animeSkipMixed } from '$lib/server/metadata/animeskip';
import { introDbTimes } from '$lib/server/metadata/introdb';
import { theIntroDbTimes } from '$lib/server/metadata/theintrodb';
import type { RequestHandler } from './$types';

/**
 * Intro, recap and credits from the community databases at once: AniSkip and Anime Skip (anime,
 * each checks the cut), then IntroDB and TheIntroDB (any show). Each kind of part comes from the
 * first anime one that has it; otherwise from whichever of IntroDB and TheIntroDB more people sent
 * it to (TheIntroDB on a tie: it checks the cut). When TheIntroDB says people timed another cut
 * than this copy (another length), neither of the two is used (theintrodb.ts says why).
 * ?title=&episode=<counted from the show's first>&duration=, and the player's own
 * &season=&number= when known (Anime Skip often goes by season).
 */
export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim();
	const episode = Number(url.searchParams.get('episode'));
	const duration = Number(url.searchParams.get('duration'));
	const season = Number(url.searchParams.get('season')) || 0;
	const number = Number(url.searchParams.get('number')) || episode;

	if (!title || !Number.isInteger(episode) || episode < 1 || !(duration > 60)) {
		return error(400, 'Missing title, episode or duration');
	}

	const [aniSkip, animeSkip, introDb, theIntroDb, mixedKinds] = await Promise.all([
		skipTimesFor(title, episode, duration).catch(() => [] as SkipSegment[]),
		animeSkipTimes(title, season, number, episode, duration).catch(() => [] as SkipSegment[]),
		introDbTimes(title, season, number, duration).catch(() => [] as SkipSegment[]),
		theIntroDbTimes(title, season, number, duration).catch(() => ({ segments: [] as SkipSegment[], otherCut: false })),
		animeSkipMixed(title, season, number, episode).catch(() => [] as SkipSegment['type'][])
	]);
	// Each kind of part from the first that has it: the two that check the cut's length, then the
	// one of IntroDB and TheIntroDB more people agree on.
	const segments: SkipSegment[] = [];
	const crowd = theIntroDb.otherCut ? [] : [...theIntroDb.segments, ...introDb].sort((a, b) => (b.votes ?? 1) - (a.votes ?? 1));
	const all = [...aniSkip, ...animeSkip, ...crowd];
	for (const s of all) if (!segments.some((t) => t.type === s.type)) segments.push({ ...s });
	// Story over the song, by any of them (Anime Skip in any cut of the episode), wins: IntroDB had
	// Re:Zero S2E16's ending as a plain outro, Anime Skip as Mixed Credits, and auto-skip jumped
	// past the end of the episode's story.
	for (const s of segments) {
		const overlapping = all.some((o) => o.mixed && o.type === s.type && o.start < s.end && s.start < o.end);
		if (overlapping || mixedKinds.includes(s.type)) s.mixed = true;
	}
	return json(segments.map(({ votes: _, ...s }) => s).sort((a, b) => a.start - b.start));
};
