import type { AniListMedia } from './anilist';

export type AnimeNode = AniListMedia & {
	relations?: { edges: { relationType: string; node: { id: number; format: string | null } }[] } | null;
};

/**
 * AniList allows only so many requests a minute, shared by everything on this connection.
 * When it says "too many", every caller leaves it alone for as long as it asked, rather than
 * waiting and retrying (which made searches take four seconds and still fail). Search falls
 * back to TMDB, which has the anime too, until AniList is ready again.
 */
let restingUntil = 0;

export function anilistResting(): boolean {
	return Date.now() < restingUntil;
}

/** Call with AniList's 429 reply. */
export function anilistSaidWait(response: Response): void {
	const seconds = Number(response.headers.get('Retry-After') ?? '30') || 30;
	restingUntil = Date.now() + Math.min(seconds, 120) * 1000;
}

/** Every AniList entry already seen this session, with its season links — saves asking again. */
export const animeNodes = new Map<number, AnimeNode>();

export function rememberAnime(media: AnimeNode[]): void {
	for (const m of media) if (m?.id && m.relations) animeNodes.set(m.id, m);
}
