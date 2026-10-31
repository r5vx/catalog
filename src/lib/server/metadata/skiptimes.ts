/**
 * Intro, recap and credits timestamps for anime episodes, from AniSkip — a free,
 * crowd-sourced database keyed by MyAnimeList id and episode number.
 *
 * Showbox numbers seasons the way TMDB does, which often isn't how MyAnimeList splits
 * a show (one TMDB season can be two MyAnimeList entries). So the episode is counted
 * from the very start of the series and walked along the chain of sequels.
 *
 * The MyAnimeList ids and the chain come from Kitsu (free, no sign-up, answers in a fraction of
 * a second and doesn't ration questions the way AniList, which this used before, does).
 */

/**
 * `mixed`: the story carries on over the song (AniSkip's mixed-ed, Anime Skip's Mixed Credits):
 * the Skip button shows, but it's never skipped by itself.
 */
export type SkipSegment = { type: 'intro' | 'recap' | 'credits'; start: number; end: number; mixed?: boolean; votes?: number };

type KitsuAnime = {
	id: string;
	attributes: {
		canonicalTitle: string | null;
		titles: Record<string, string | null> | null;
		abbreviatedTitles: string[] | null;
		subtype: string | null;
		episodeCount: number | null;
	};
	relationships?: { mappings?: { data?: { id: string }[] } };
};
type KitsuMapping = { id: string; attributes: { externalSite: string; externalId: string } };

type Part = { malId: number | null; episodes: number | null };
type Chain = { parts: Part[]; nextId: string | null; visited: Set<string>; checkedAt: number };

const KITSU = 'https://kitsu.io/api/edge';
const DAY = 24 * 60 * 60 * 1000;

/** Kinds that count as a season. Films and OVAs in the chain are stepped over. */
const SEASON_KINDS = new Set(['TV', 'ONA']);

const chains = new Map<string, Chain>();
const segmentsCache = new Map<string, { segments: SkipSegment[]; checkedAt: number }>();

const normalize = (text: string) =>
	text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

async function kitsu<T>(path: string): Promise<T | null> {
	try {
		const response = await fetch(`${KITSU}${path}`, {
			headers: { Accept: 'application/vnd.api+json' },
			signal: AbortSignal.timeout(8000)
		});
		return response.ok ? ((await response.json()) as T) : null;
	} catch {
		return null;
	}
}

/** One entry's MyAnimeList id, from the mappings that came with it (or asked for). */
async function malIdOf(anime: KitsuAnime, included?: KitsuMapping[]): Promise<number | null> {
	let mappings = included?.filter((m) => anime.relationships?.mappings?.data?.some((d) => d.id === m.id));
	if (!mappings?.length) mappings = (await kitsu<{ data: KitsuMapping[] }>(`/anime/${anime.id}/mappings`))?.data ?? [];
	const mal = mappings.find((m) => m.attributes.externalSite === 'myanimelist/anime');
	return mal ? Number(mal.attributes.externalId) || null : null;
}

async function absorb(chain: Chain, anime: KitsuAnime, included?: KitsuMapping[]) {
	chain.visited.add(anime.id);
	if (SEASON_KINDS.has(anime.attributes.subtype ?? '')) {
		chain.parts.push({ malId: await malIdOf(anime, included), episodes: anime.attributes.episodeCount });
	}
	const sequels = await kitsu<{ data: { relationships: { destination: { data: { id: string } } } }[]; included?: KitsuAnime[] }>(
		`/anime/${anime.id}/media-relationships?filter[role]=sequel&include=destination`
	);
	const next =
		sequels?.included?.find((one) => SEASON_KINDS.has(one.attributes.subtype ?? '') && !chain.visited.has(one.id)) ??
		sequels?.included?.find((one) => !chain.visited.has(one.id));
	chain.nextId = next?.id ?? null;
}

/** Null when Kitsu couldn't be asked; an empty chain when it isn't an anime it knows. */
async function chainFor(title: string): Promise<Chain | null> {
	const key = normalize(title);
	const cached = chains.get(key);
	if (cached && Date.now() - cached.checkedAt < DAY) return cached;

	const found = await kitsu<{ data: KitsuAnime[]; included?: KitsuMapping[] }>(
		`/anime?filter[text]=${encodeURIComponent(title)}&include=mappings&page[limit]=8`
	);
	if (!found) return null;

	// Exact names only — a near miss would put another show's intro on this one.
	const match = found.data.find(
		(anime) =>
			SEASON_KINDS.has(anime.attributes.subtype ?? '') &&
			[anime.attributes.canonicalTitle, ...Object.values(anime.attributes.titles ?? {}), ...(anime.attributes.abbreviatedTitles ?? [])].some(
				(name) => name && normalize(name) === key
			)
	);

	const chain: Chain = { parts: [], nextId: null, visited: new Set(), checkedAt: Date.now() };
	if (match) await absorb(chain, match, found.included);
	chains.set(key, chain);
	return chain;
}

/** Which MyAnimeList entry, and which episode of it, the nth episode of the series is. */
async function locate(title: string, overallEpisode: number) {
	const chain = await chainFor(title);
	if (!chain) return null;

	let remaining = overallEpisode;
	let index = 0;
	for (let hops = 0; hops < 15; hops++) {
		for (; index < chain.parts.length; index++) {
			const part = chain.parts[index];
			// No count means it's still airing, so it holds everything from here on.
			if (part.episodes == null || remaining <= part.episodes) {
				return part.malId ? { malId: part.malId, episode: remaining } : null;
			}
			remaining -= part.episodes;
		}
		if (!chain.nextId) return null;
		const next = await kitsu<{ data: KitsuAnime }>(`/anime/${chain.nextId}`);
		if (!next?.data) return null;
		await absorb(chain, next.data);
	}
	return null;
}

const KIND: Record<string, SkipSegment['type']> = {
	op: 'intro',
	'mixed-op': 'intro',
	recap: 'recap',
	ed: 'credits',
	'mixed-ed': 'credits'
};

/** Skippable parts of an episode. `duration` is the real file's length in seconds. */
export async function skipTimesFor(
	title: string,
	overallEpisode: number,
	duration: number
): Promise<SkipSegment[]> {
	const spot = await locate(title, overallEpisode);
	if (!spot) return [];

	const length = Math.round(duration);
	const key = `${spot.malId}:${spot.episode}:${length}`;
	const cached = segmentsCache.get(key);
	if (cached && Date.now() - cached.checkedAt < DAY) return cached.segments;

	const params = new URLSearchParams();
	for (const type of Object.keys(KIND)) params.append('types', type);
	// AniSkip picks the submission timed against the release closest to this length.
	params.set('episodeLength', String(length));

	let body: {
		results?: { skipType: string; interval: { startTime: number; endTime: number }; episodeLength: number }[];
	};
	try {
		const response = await fetch(
			`https://api.aniskip.com/v2/skip-times/${spot.malId}/${spot.episode}?${params}`,
			{ signal: AbortSignal.timeout(8000) }
		);
		if (response.status === 404) {
			segmentsCache.set(key, { segments: [], checkedAt: Date.now() });
			return [];
		}
		if (!response.ok) return [];
		body = await response.json();
	} catch {
		return [];
	}

	const segments: SkipSegment[] = [];
	for (const result of body.results ?? []) {
		const type = KIND[result.skipType];
		const { startTime, endTime } = result.interval;
		// Timed against a noticeably different cut, the times wouldn't line up with this file.
		if (!type || Math.abs(result.episodeLength - duration) > 30) continue;
		if (endTime - startTime < 5 || segments.some((segment) => segment.type === type)) continue;
		segments.push({ type, start: startTime, end: endTime, ...(result.skipType.startsWith('mixed') ? { mixed: true } : {}) });
	}

	segmentsCache.set(key, { segments, checkedAt: Date.now() });
	return segments;
}
