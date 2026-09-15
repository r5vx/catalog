/** One row in the "search for something to add" list. */
export type SearchResult = {
	/** Unique across providers, e.g. "anilist:99423". Used as the form value. */
	key: string;
	source: 'anilist' | 'tmdb';
	sourceId: string;
	title: string;
	/** Shown underneath when it differs, e.g. the Japanese/romaji title. */
	altTitle: string | null;
	year: number | null;
	posterUrl: string | null;
	overview: string | null;
	/** Which category we think this belongs in. */
	categorySlug: 'anime' | 'movies' | 'tv';
	/** False when the guess is a coin flip and the user should look at it. */
	confident: boolean;
	/** "TV", "Movie", "OVA" — shown as a small label. */
	kind: string;
	episodesTotal: number | null;
	runtimeMinutes: number | null;
	/** The public score out of 10, and how many people voted on it. */
	externalRating: number | null;
	externalVotes: number | null;
	/**
	 * How well known this is, from 0 to 1, on a scale that means the same thing
	 * for every provider. Each provider converts its own numbers into this, so
	 * a blockbuster and a famous anime can be compared honestly — and an obscure
	 * anime scores low even when it's the most popular thing in its own results.
	 */
	popularity: number;
};

/**
 * Turn a provider's "how well known is this" number into a 0-1 score that means
 * the same thing for everyone.
 *
 * A plain log scale isn't enough on its own: it squashes everything toward the
 * middle, so a title with 900 fans still scored ~0.5 and tied with a
 * blockbuster. Anchoring to a floor and a ceiling fixes that — below `floor` is
 * genuinely obscure and scores 0, at `ceiling` it's a household name.
 */
export function fameScore(value: number, floor: number, ceiling: number): number {
	const v = Math.log10(Math.max(0, value) + 1);
	const lo = Math.log10(floor);
	const hi = Math.log10(ceiling);

	return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

/** Strip HTML tags and collapse whitespace — AniList descriptions contain markup. */
export function plainText(input: string | null | undefined): string | null {
	if (!input) return null;
	const text = input
		.replace(/<br\s*\/?>/gi, ' ')
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return text || null;
}

/** Normalised form used for matching and de-duplicating titles. */
export function normalizeTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}
