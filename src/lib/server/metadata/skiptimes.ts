/**
 * Intro, recap and credits timestamps for anime episodes, from AniSkip — a free,
 * crowd-sourced database keyed by MyAnimeList id and episode number.
 *
 * Showbox numbers seasons the way TMDB does, which often isn't how AniList splits
 * a show (one TMDB season can be two AniList entries). So the episode is counted
 * from the very start of the series and walked along AniList's chain of sequels.
 */

export type SkipSegment = { type: 'intro' | 'recap' | 'credits'; start: number; end: number };

type Edge = { relationType: string; node: { id: number; format: string | null } };
type Media = {
	id: number;
	idMal: number | null;
	episodes: number | null;
	format: string | null;
	relations?: { edges: Edge[] } | null;
};
type SearchMedia = Media & {
	title: { english: string | null; romaji: string | null };
	synonyms: string[] | null;
};

type Part = { malId: number | null; episodes: number | null };
type Chain = { parts: Part[]; nextId: number | null; visited: Set<number>; checkedAt: number };

const ANILIST = 'https://graphql.anilist.co';
const DAY = 24 * 60 * 60 * 1000;

/** Formats that count as a season. Films and OVAs in the chain are stepped over. */
const SEASON_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA']);

const MEDIA_FIELDS = 'id idMal episodes format relations { edges { relationType node { id format } } }';

const SEARCH = `query ($search: String) {
  Page(perPage: 8) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH, format_in: [TV, TV_SHORT, ONA]) {
      title { english romaji }
      synonyms
      ${MEDIA_FIELDS}
    }
  }
}`;

const BY_ID = `query ($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`;

const chains = new Map<string, Chain>();
const segmentsCache = new Map<string, { segments: SkipSegment[]; checkedAt: number }>();

const normalize = (text: string) =>
	text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

async function anilist<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
	const init = {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({ query, variables })
	};
	try {
		let response = await fetch(ANILIST, { ...init, signal: AbortSignal.timeout(8000) });
		if (response.status === 429) {
			const wait = Number(response.headers.get('Retry-After') ?? '2');
			await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 10) * 1000));
			response = await fetch(ANILIST, { ...init, signal: AbortSignal.timeout(8000) });
		}
		if (!response.ok) return null;
		return ((await response.json()) as { data?: T }).data ?? null;
	} catch {
		return null;
	}
}

function absorb(chain: Chain, media: Media) {
	chain.visited.add(media.id);
	if (SEASON_FORMATS.has(media.format ?? '')) {
		chain.parts.push({ malId: media.idMal, episodes: media.episodes });
	}
	const sequels = (media.relations?.edges ?? []).filter((edge) => edge.relationType === 'SEQUEL');
	const next = sequels.find((edge) => SEASON_FORMATS.has(edge.node.format ?? '')) ?? sequels[0];
	chain.nextId = next && !chain.visited.has(next.node.id) ? next.node.id : null;
}

/** Null when AniList couldn't be asked; an empty chain when it isn't an anime it knows. */
async function chainFor(title: string): Promise<Chain | null> {
	const key = normalize(title);
	const cached = chains.get(key);
	if (cached && Date.now() - cached.checkedAt < DAY) return cached;

	const data = await anilist<{ Page: { media: SearchMedia[] } }>(SEARCH, { search: title });
	if (!data) return null;

	// Exact names only — a near miss would put another show's intro on this one.
	const match = data.Page.media.find((media) =>
		[media.title.english, media.title.romaji, ...(media.synonyms ?? [])].some(
			(name) => name && normalize(name) === key
		)
	);

	const chain: Chain = { parts: [], nextId: null, visited: new Set(), checkedAt: Date.now() };
	if (match) absorb(chain, match);
	chains.set(key, chain);
	return chain;
}

/** Which AniList entry, and which episode of it, the nth episode of the series is. */
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
		const data = await anilist<{ Media: Media }>(BY_ID, { id: chain.nextId });
		if (!data?.Media) return null;
		absorb(chain, data.Media);
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
		segments.push({ type, start: startTime, end: endTime });
	}

	segmentsCache.set(key, { segments, checkedAt: Date.now() });
	return segments;
}
