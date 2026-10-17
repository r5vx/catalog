import { json } from '@sveltejs/kit';
import { tmdbShow } from '$lib/server/combinedEpisodes';
import { tmdbGet } from '$lib/server/metadata/tmdb';
import { getOrderCache, saveOrderCache } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

/**
 * Whether a title is anime — Japanese original language and TMDB's Animation genre — so the
 * player starts it in Japanese. A film that merely has a Japanese dub (Avatar) isn't.
 * ?title=&type=tv|movie&year=. Kept a month.
 */
type Film = { original_language?: string; genre_ids?: number[]; title?: string; release_date?: string };

export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim() ?? '';
	const type = url.searchParams.get('type') === 'movie' ? 'movie' : 'tv';
	const year = url.searchParams.get('year') ?? '';
	if (!title) return json({ anime: false });

	const key = `is-anime|${type}|${title.toLowerCase()}|${year}`;
	const kept = getOrderCache(key);
	if (kept && Date.now() - kept.at < 30 * 24 * 60 * 60 * 1000) return json({ anime: kept.value === true });

	let anime: boolean | null = null;
	if (type === 'tv') {
		const show = await tmdbShow(title, year).catch(() => null);
		anime = show ? show.anime : null;
	} else {
		const params: Record<string, string> = { query: title };
		if (year) params.year = year;
		const found = await tmdbGet<{ results?: Film[] }>('/search/movie', params);
		if (found) {
			const want = title.toLowerCase();
			const film = found.results?.find((f) => f.title?.toLowerCase() === want) ?? found.results?.[0];
			anime = Boolean(film && film.original_language === 'ja' && film.genre_ids?.includes(16));
		}
	}
	// Only an answer is kept: TMDB not answering isn't "not anime".
	if (anime !== null) saveOrderCache(key, anime, Date.now());
	return json({ anime: anime === true });
};
