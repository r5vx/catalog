/**
 * The same title and year, however it's written: "Re:ZERO -Starting Life in Another World-"
 * (2016) from AniList and from TMDB both give "title:rezerostartinglifeinanotherworld|2016".
 * Lets a search result count as in the library when it came from the other site.
 */
export const titleKey = (title: string, year?: number | string | null) =>
	`title:${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')}|${year ?? ''}`;
