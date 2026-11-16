import { json } from '@sveltejs/kit';
import { cloud, onlineConnected } from '$lib/server/online';
import { currentProfile } from '$lib/server/profile';
import { tmdbGet } from '$lib/server/metadata/tmdb';
import { getOrderCache, saveOrderCache } from '$lib/server/db/queries';
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
const MONTH = 30 * 24 * 60 * 60 * 1000;
const MOST = 12;

async function isAnime(key: string): Promise<boolean> {
	if (key.startsWith('anilist:')) return true;
	const m = key.match(/^tmdb:tv:(\d+)$/);
	if (!m) return false;
	const kept = getOrderCache(`friend-anime|${key}`);
	if (kept && Date.now() - kept.at < MONTH) return Boolean(kept.value);
	const show = await tmdbGet<{ original_language?: string; genres?: { id: number }[] }>(`/tv/${m[1]}`).catch(() => null);
	if (!show) return false;
	const anime = show.original_language === 'ja' && Boolean(show.genres?.some((g) => g.id === 16));
	saveOrderCache(`friend-anime|${key}`, anime, Date.now());
	return anime;
}

export const GET: RequestHandler = async ({ params, url }) => {
	const kind = url.searchParams.get('kind') as Kind;
	if (!onlineConnected() || !/^[A-Z0-9]{16}$/.test(params.id) || !['movie', 'tv', 'anime'].includes(kind)) return json({ items: [] });

	// Their library, best rated first, of films or of shows (anime is among the shows).
	const answer = await cloud<{ items?: Titled[] }>(`/v1/people/${params.id}/library?type=${kind === 'movie' ? 'movie' : 'tv'}`, { profile: currentProfile() });
	const rated = (answer.ok ? (answer.data?.items ?? []) : []).filter((item) => item.rating != null);
	if (kind === 'movie') return json({ items: rated.slice(0, MOST) });

	const items: Titled[] = [];
	for (const item of rated) {
		if ((await isAnime(item.key)) === (kind === 'anime')) items.push(item);
		if (items.length >= MOST) break;
	}
	return json({ items });
};
