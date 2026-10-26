import { json } from '@sveltejs/kit';
import { seasonEpisodes, showSeasons } from '$lib/server/tvEpisodes';
import { watchedEpisodesForTitle } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

/**
 * A show's seasons and one season's episodes for the Roku's title screen, chosen as the Fire
 * TV's title screen chooses them: when the player numbers the show its own way (Showbox's
 * seasons: Bleach is 2 seasons on TMDB, 18 in the player), the player's, so picking an episode
 * opens exactly that one; otherwise TMDB's, with their pictures.
 * ?source=&id=&title=<the name it plays under>&year=&season=
 */
type PlayerList = { title: string; seasons: { number: number; count: number }[]; episodes: { season: number; episode: number; available: boolean; airDate: string | null }[] };

export const GET: RequestHandler = async ({ url, request }) => {
	const forward: Record<string, string> = {};
	for (const name of ['cookie', 'user-agent']) {
		const value = request.headers.get(name);
		if (value) forward[name] = value;
	}
	const ask = <T>(path: string, ms: number): Promise<T | null> =>
		fetch(new URL(path, url.origin), { headers: forward, signal: AbortSignal.timeout(ms) })
			.then((r) => (r.ok ? (r.json() as Promise<T>) : null))
			.catch(() => null);
	const get = (name: string) => url.searchParams.get(name) ?? '';
	const title = get('title');
	let wanted = Number(get('season'));

	const show = await showSeasons(get('source'), get('id'), title).catch(() => null);
	const list = await ask<PlayerList & { retryIn?: number }>(`/api/tv/player-episodes?${new URLSearchParams({ title, year: get('year') })}`, 12_000);
	const same =
		!list?.seasons?.length ||
		(!!show &&
			list.seasons.length === show.seasons.length &&
			list.seasons.every((s, i) => s.number === show.seasons[i].number && Math.abs(s.count - show.seasons[i].count) <= 2));
	// Out from 06:00 UTC the day after its US air date (as on the Fire TV).
	const aired = (date: string | null) => !date || Date.now() >= Date.parse(`${date}T00:00:00Z`) + 30 * 60 * 60 * 1000;

	if (!same && list) {
		if (!list.seasons.some((s) => s.number === wanted)) wanted = list.seasons[0].number;
		const eps = list.episodes.filter((e) => e.season === wanted);
		let before = 0;
		for (const s of list.seasons) if (s.number < wanted) before += s.count;
		const names =
			(await ask<Record<number, string>>(
				`/api/watch/episode-names?${new URLSearchParams({ title: list.title, season: String(wanted), before: String(before), count: String(eps.length) })}`,
				10_000
			)) ?? {};
		const watched = watchedEpisodesForTitle(list.title);
		return json({
			title: list.title,
			seasons: list.seasons,
			season: wanted,
			episodes: eps.map((e) => ({
				episode: e.episode,
				name: names[e.episode] ?? `Episode ${e.episode}`,
				still: null,
				runtime: null,
				airDate: e.airDate,
				available: e.available && aired(e.airDate),
				progress: Math.min(1, watched.find((w) => w.season === wanted && w.episode === e.episode)?.pct ?? 0)
			}))
		});
	}

	if (!show) return json({ title, seasons: [], season: 0, episodes: [] });
	if (!show.seasons.some((s) => s.number === wanted)) wanted = show.seasons[0]?.number ?? 0;
	const episodes = wanted ? await seasonEpisodes(show.showId, wanted).catch(() => []) : [];
	const watched = watchedEpisodesForTitle(title).filter((w) => w.season === wanted);
	return json({
		title,
		seasons: show.seasons.map((s) => ({ number: s.number, count: s.count })),
		season: wanted,
		episodes: episodes.map((e) => ({
			...e,
			available: aired(e.airDate),
			progress: Math.min(1, watched.find((w) => w.episode === e.episode)?.pct ?? 0)
		}))
	});
};
