import { json } from '@sveltejs/kit';
import { tmdbShow } from '$lib/server/combinedEpisodes';
import { tmdbGet } from '$lib/server/metadata/tmdb';
import { getOrderCache, saveOrderCache } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

/**
 * Whether a title is anime — Japanese original language and TMDB's Animation genre — so the
 * player starts it in Japanese. A film that merely has a Japanese dub (Avatar) isn't.
 * Also its original language (`original`, "en"): a copy with no sound in it, nor in English,
 * is passed over (Digger's only Showbox copies had Russian, Ukrainian, Kazakh and Uzbek, 2026-11-16).
 * ?title=&type=tv|movie&year=. Kept a month.
 */
type Film = { original_language?: string; genre_ids?: number[]; title?: string; release_date?: string };
type Answer = { anime: boolean; original: string };

export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim() ?? '';
	const type = url.searchParams.get('type') === 'movie' ? 'movie' : 'tv';
	const year = url.searchParams.get('year') ?? '';
	if (!title) return json({ anime: false, original: '' });

	// (Was a plain true/false until 2026-11-16: those are asked again, for the language.)
	const key = `is-anime2|${type}|${title.toLowerCase()}|${year}`;
	const kept = getOrderCache(key);
	if (kept && Date.now() - kept.at < 30 * 24 * 60 * 60 * 1000) return json(kept.value as Answer);

	let answer: Answer | null = null;
	if (type === 'tv') {
		const show = await tmdbShow(title, year).catch(() => null);
		if (show) answer = { anime: show.anime, original: show.language ?? '' };
	} else {
		const params: Record<string, string> = { query: title };
		if (year) params.year = year;
		const found = await tmdbGet<{ results?: Film[] }>('/search/movie', params);
		if (found) {
			const want = title.toLowerCase();
			const film = found.results?.find((f) => f.title?.toLowerCase() === want) ?? found.results?.[0];
			answer = {
				anime: Boolean(film && film.original_language === 'ja' && film.genre_ids?.includes(16)),
				original: film?.original_language ?? ''
			};
		}
	}
	// Only an answer is kept: TMDB not answering isn't "not anime". (A show kept from before
	// 2026-11-16 has no language yet: not kept, so it's asked again once that's known.)
	if (answer && (type === 'movie' || answer.original)) saveOrderCache(key, answer, Date.now());
	return json(answer ?? { anime: false, original: '' });
};
