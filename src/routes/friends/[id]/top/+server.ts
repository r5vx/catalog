import { json } from '@sveltejs/kit';
import { cloud, onlineConnected } from '$lib/server/online';
import { currentProfile } from '$lib/server/profile';
import { isFriendAnime } from '$lib/server/friendAnime';
import type { Titled } from '../+page.server';
import type { RequestHandler } from './$types';

/**
 * A friend's highest rated, just films, shows or anime (the chips beside "Highest rated" on their
 * profile; owner, 2026-11-16: "top 10 anime or top 10 movies"). ?kind=movie|tv|anime.
 *
 * The meeting point only knows film or show, so anime is told apart here: anything from AniList,
 * or a TMDB show that's Japanese and animated (asked once, kept a month). Your own profile doesn't
 * ask this: it has the library's own categories (+page.server.ts).
 */
type Kind = 'movie' | 'tv' | 'anime';
const MOST = 12;

/** Marked by a newer Catalog, else looked up (friendAnime.ts). */
const isAnime = async (item: Titled & { anime?: boolean }) => item.anime ?? (await isFriendAnime(item.key));

export const GET: RequestHandler = async ({ params, url }) => {
	const kind = url.searchParams.get('kind') as Kind;
	if (!onlineConnected() || !/^[A-Z0-9]{16}$/.test(params.id) || !['movie', 'tv', 'anime'].includes(kind)) return json({ items: [] });

	// Their library, best rated first, of films or of shows (anime is among the shows).
	const answer = await cloud<{ items?: Titled[] }>(`/v1/people/${params.id}/library?type=${kind === 'movie' ? 'movie' : 'tv'}`, { profile: currentProfile() });
	const rated = (answer.ok ? (answer.data?.items ?? []) : []).filter((item) => item.rating != null);
	if (kind === 'movie') return json({ items: rated.slice(0, MOST) });

	const items: Titled[] = [];
	for (const item of rated) {
		if ((await isAnime(item)) === (kind === 'anime')) items.push(item);
		if (items.length >= MOST) break;
	}
	return json({ items });
};
