/**
 * Reading an OMDb response.
 *
 * Kept apart from the fetching, and importing nothing, so it can be run
 * against real captured payloads without a key or a network — which matters,
 * because the key is optional and most of the time there isn't one to test
 * with.
 */

export type Scores = {
	imdbId: string | null;
	imdbRating: number | null;
	imdbVotes: number | null;
	/** Rotten Tomatoes, as a percentage. Critics only — OMDb has no audience score. */
	rtScore: number | null;
	/** Metacritic, out of 100. */
	metascore: number | null;
	/** "PG-13", "TV-MA" — what it's rated. */
	contentRating: string | null;
	awards: string | null;
	/** Worldwide gross, in dollars. Films only; series never have one. */
	boxOffice: number | null;
};

export const EMPTY_SCORES: Scores = {
	imdbId: null,
	imdbRating: null,
	imdbVotes: null,
	rtScore: null,
	metascore: null,
	contentRating: null,
	awards: null,
	boxOffice: null
};

/** OMDb writes "N/A" where other APIs would write null. */
export const real = (value: unknown): string | null => {
	const text = String(value ?? '').trim();
	return text && text !== 'N/A' ? text : null;
};

/** Numbers arrive with commas, dollar signs and units attached. */
const toNumber = (value: string | null): number | null => {
	if (value === null) return null;
	const n = Number(value.replace(/[$,]/g, ''));
	return Number.isFinite(n) ? n : null;
};

export function parseOmdb(data: Record<string, unknown> | null | undefined): Scores {
	// OMDb answers 200 with {"Response":"False"} when it has nothing.
	if (!data || data.Response === 'False') return EMPTY_SCORES;

	// Rotten Tomatoes and Metacritic appear only inside the Ratings list, as
	// "91%" and "82/100" — their own scales, not a shared one.
	const ratings = (data.Ratings ?? []) as { Source?: string; Value?: string }[];
	const valueFrom = (source: string) =>
		real(ratings.find((entry) => entry.Source === source)?.Value);

	const rt = valueFrom('Rotten Tomatoes');
	const meta = valueFrom('Metacritic');

	return {
		imdbId: real(data.imdbID),
		imdbRating: toNumber(real(data.imdbRating)),
		imdbVotes: toNumber(real(data.imdbVotes)),
		rtScore: rt ? toNumber(rt.replace('%', '')) : null,
		// The top-level Metascore is the fallback; the Ratings entry is richer.
		metascore: meta ? toNumber(meta.split('/')[0]) : toNumber(real(data.Metascore)),
		contentRating: real(data.Rated),
		awards: real(data.Awards),
		// Arrives formatted, like "$858,373,000".
		boxOffice: toNumber(real(data.BoxOffice))
	};
}
