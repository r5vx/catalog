/**
 * "18 seasons" under a show's name. When the player numbers the show its own way (Showbox's
 * seasons: Bleach is 2 seasons on TMDB, 18 in the player), its count, so the line agrees with
 * the season buttons below it; otherwise TMDB's. Specials aren't counted as a season.
 */
export function seasonsWord(tmdbCount: number | null | undefined, playerSeasons?: { number: number }[] | null): string | null {
	const own = playerSeasons?.filter((s) => s.number > 0).length ?? 0;
	const count = own || tmdbCount || 0;
	return count ? `${count} season${count === 1 ? '' : 's'}` : null;
}
