import { json } from '@sveltejs/kit';
import { keepPlayerList, keptPlayerList, type PlayerList } from '$lib/server/tvEpisodes';
import type { RequestHandler } from './$types';

/** A kept list older than this is looked up again in the background. */
const RECHECK = 10 * 60 * 1000;
const rechecking = new Set<string>();

/**
 * A show's episodes as the player lists them (Showbox's seasons where it splits a show its own
 * way: Bleach is 2 seasons on TMDB, 18 in the player), for the TV's title screen, so picking an
 * episode there opens exactly that one. Uses the player's own lookup, so it's kept for the player
 * too. ?title=&year=
 *
 * The last complete list is kept (in the library), so a show being watched opens with all its
 * seasons straight away; it's looked up again in the background, for new episodes next time.
 *
 * `retryIn` (seconds): the list isn't complete yet — Febbox refused a folder just now, so the
 * answer is another source's numbering or missing seasons — and is worth asking for again then.
 */
export const GET: RequestHandler = async ({ url, fetch }) => {
	const title = url.searchParams.get('title')?.trim();
	if (!title) return json(null);
	const year = url.searchParams.get('year') ?? '';
	const key = `${title.toLowerCase()}|${year}`;

	const lookUp = async (): Promise<PlayerList | { retryIn: number } | null> => {
		const params = new URLSearchParams({ title, type: 'tv', year, nostream: '1' });
		const data = await fetch(`/api/watch/resolve?${params}`)
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		const list = playerList(data);
		// Kept only when Showbox answered (never another source's numbering while it was busy).
		// A list that's only short of other sources' extras is kept all the same.
		const showboxAnswered = !data?.showboxBusy && data?.error !== 'busy';
		if (list && 'seasons' in list && showboxAnswered) keepPlayerList(title, year, { ...list, retryIn: undefined });
		return list;
	};

	const kept = keptPlayerList(title, year);
	if (kept) {
		if (Date.now() - kept.at > RECHECK && !rechecking.has(key)) {
			rechecking.add(key);
			lookUp()
				.catch(() => null)
				.finally(() => rechecking.delete(key));
		}
		return json(kept.list);
	}
	return json(await lookUp());
};

/** The player's lookup answer as the TV page wants it. */
function playerList(data: any): PlayerList | { retryIn: number } | null {
	type Listed = { season: number; episode: number; available?: boolean; airDate?: string | null; files: unknown[] };
	const listed: Listed[] = data?.episodes?.episodes ?? [];
	const retryIn = Number(data?.showboxBusy || (data?.error === 'busy' ? data.retryIn : 0) || (data?.episodes?.partial ? 5 : 0)) || 0;
	if (!listed.length) return retryIn ? { retryIn } : null;
	const seasons = [...new Set(listed.map((e) => e.season))]
		.filter((n) => n > 0)
		.sort((a, b) => a - b)
		.map((number) => ({ number, count: listed.filter((e) => e.season === number).length }));
	return {
		title: data.title as string,
		...(retryIn ? { retryIn } : {}),
		seasons,
		episodes: listed
			.filter((e) => e.season > 0)
			.map((e) => ({
				season: e.season,
				episode: e.episode,
				available: e.available !== false && e.files.length > 0,
				airDate: e.airDate ?? null
			}))
	};
}
