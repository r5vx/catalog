import { json, error } from '@sveltejs/kit';
import { tmdbShow } from '$lib/server/combinedEpisodes';
import { nexusSubtitlesFor, tmdbEpisodeOfAniwave } from '$lib/server/sources';
import { parseAniwaveShareKey } from '$lib/server/sources/aniwave';
import type { RequestHandler } from './$types';

/**
 * Shows anime.nexus's page for this episode so the owner can pass its human check, and waits
 * until its subtitle list comes through (the page closes by itself). Desktop app only.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { title, year, season, episode, ref } = await request.json();
	if (!title || !season || !episode) return error(400, 'Missing title or episode');

	let show = await tmdbShow(title, year ?? '');
	if (year && !show?.anime) show = (await tmdbShow(title, '')) ?? show;
	if (!show) return json({ ok: false });

	// By TMDB's numbering, found through the episode's Aniwave copy when there is one.
	const aniwave = parseAniwaveShareKey(String(ref ?? ''));
	const tmdb = aniwave ? await tmdbEpisodeOfAniwave(show, title, aniwave.id, aniwave.episode) : null;
	const subs = await nexusSubtitlesFor(show, title, tmdb?.season ?? Number(season), tmdb?.episode ?? Number(episode), true);
	return json({ ok: Array.isArray(subs) && subs.length > 0 });
};
