import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * A show's episodes as the player lists them (Showbox's seasons where it splits a show its own
 * way: Bleach is 2 seasons on TMDB, 18 in the player), for the TV's title screen, so picking an
 * episode there opens exactly that one. Uses the player's own lookup, so it's kept for the player
 * too. ?title=&year=
 */
export const GET: RequestHandler = async ({ url, fetch }) => {
	const title = url.searchParams.get('title')?.trim();
	if (!title) return json(null);
	const params = new URLSearchParams({ title, type: 'tv', year: url.searchParams.get('year') ?? '', nostream: '1' });
	const data = await fetch(`/api/watch/resolve?${params}`)
		.then((r) => (r.ok ? r.json() : null))
		.catch(() => null);
	type Listed = { season: number; episode: number; available?: boolean; airDate?: string | null; name?: string; files: unknown[] };
	const listed: Listed[] = data?.episodes?.episodes ?? [];
	if (!listed.length) return json(null);
	const seasons = [...new Set(listed.map((e) => e.season))]
		.filter((n) => n > 0)
		.sort((a, b) => a - b)
		.map((number) => ({ number, count: listed.filter((e) => e.season === number).length }));
	return json({
		title: data.title as string,
		seasons,
		episodes: listed
			.filter((e) => e.season > 0)
			.map((e) => ({
				season: e.season,
				episode: e.episode,
				available: e.available !== false && e.files.length > 0,
				airDate: e.airDate ?? null
			}))
	});
};
