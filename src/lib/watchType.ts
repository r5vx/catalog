/**
 * Whether something plays as a film or as a series. One rule for everywhere a Watch button is
 * (the library, Browse, people's pages, a friend's list, the TV, a title's page), so a fix here
 * reaches every title at once.
 *
 * A film is: in Movies, a TMDB film, labelled a film, or anime with a single episode (a special
 * or OVA, like One Piece Heroines, which played as a show found no subtitles: everywhere else
 * calls it a film).
 */
export function playsAsFilm(title: {
	categorySlug?: string | null;
	categoryName?: string | null;
	sourceId?: string | null;
	kind?: string | null;
	episodesTotal?: number | null;
}): boolean {
	const category = (title.categorySlug ?? title.categoryName ?? '').toLowerCase();
	if (category === 'movies') return true;
	if (title.sourceId?.startsWith('movie:')) return true;
	if (title.kind === 'Movie') return true;
	return category === 'anime' && title.episodesTotal === 1;
}

export const watchTypeOf = (title: Parameters<typeof playsAsFilm>[0]): 'movie' | 'tv' => (playsAsFilm(title) ? 'movie' : 'tv');
