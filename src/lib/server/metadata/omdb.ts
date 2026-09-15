import { env } from '$env/dynamic/private';
import { readSettings } from '../settings';

/**
 * Scores from everywhere that isn't TMDB.
 *
 * TMDB has its own rating and nothing else — no IMDb number, no Rotten
 * Tomatoes, no Metacritic. OMDb is the one free source that carries all three
 * in a single response, so that's where this comes from.
 *
 * It's optional. Without a key the app works exactly as before and the scores
 * section simply doesn't appear.
 */

export type Scores = {
	imdbId: string | null;
	imdbRating: number | null;
	imdbVotes: number | null;
	/** Rotten Tomatoes, as a percentage. */
	rtScore: number | null;
	/** Metacritic, out of 100. */
	metascore: number | null;
	/** "PG-13", "TV-MA" — what it's rated. */
	contentRating: string | null;
	awards: string | null;
};

export const EMPTY_SCORES: Scores = {
	imdbId: null,
	imdbRating: null,
	imdbVotes: null,
	rtScore: null,
	metascore: null,
	contentRating: null,
	awards: null
};

const omdbKey = () => (readSettings().omdbApiKey || env.OMDB_API_KEY || '').trim();

export const omdbConfigured = () => Boolean(omdbKey());

/** OMDb writes "N/A" where other APIs would write null. */
const real = (value: unknown): string | null => {
	const text = String(value ?? '').trim();
	return text && text !== 'N/A' ? text : null;
};

const toNumber = (value: string | null): number | null => {
	if (value === null) return null;
	const n = Number(value.replace(/,/g, ''));
	return Number.isFinite(n) ? n : null;
};

/** Checks a key before it's saved, so a typo is caught immediately. */
export async function verifyOmdbKey(key: string): Promise<{ ok: boolean; message: string }> {
	try {
		const url = new URL('https://www.omdbapi.com/');
		url.searchParams.set('apikey', key.trim());
		url.searchParams.set('i', 'tt0111161'); // The Shawshank Redemption

		const response = await fetch(url);
		if (!response.ok) return { ok: false, message: `OMDb said ${response.status}.` };

		const data = await response.json();

		// OMDb answers 200 with {"Response":"False"} for a bad key.
		if (data?.Response === 'False') {
			return { ok: false, message: real(data.Error) ?? 'OMDb rejected that key.' };
		}

		return { ok: true, message: 'Key saved. IMDb and Rotten Tomatoes scores are on.' };
	} catch {
		return { ok: false, message: 'Could not reach OMDb. Check your connection.' };
	}
}

/**
 * Looks a title up, by IMDb id where we have one and by name where we don't.
 *
 * Anime from AniList has no IMDb id at all, so the title-and-year fallback is
 * the only way those get scores — it's less certain, which is why the id is
 * always preferred.
 */
export async function fetchScores(lookup: {
	imdbId?: string | null;
	title?: string | null;
	year?: number | null;
	isSeries?: boolean;
}): Promise<Scores> {
	const key = omdbKey();
	if (!key) return EMPTY_SCORES;

	const url = new URL('https://www.omdbapi.com/');
	url.searchParams.set('apikey', key);

	if (lookup.imdbId) {
		url.searchParams.set('i', lookup.imdbId);
	} else if (lookup.title) {
		url.searchParams.set('t', lookup.title);
		if (lookup.year) url.searchParams.set('y', String(lookup.year));
		if (lookup.isSeries) url.searchParams.set('type', 'series');
	} else {
		return EMPTY_SCORES;
	}

	try {
		const response = await fetch(url);
		if (!response.ok) return EMPTY_SCORES;

		const data = await response.json();
		if (data?.Response === 'False') return EMPTY_SCORES;

		// Rotten Tomatoes and Metacritic only appear inside the Ratings list.
		const ratings: { Source?: string; Value?: string }[] = data.Ratings ?? [];
		const valueFrom = (source: string) =>
			real(ratings.find((entry) => entry.Source === source)?.Value);

		const rt = valueFrom('Rotten Tomatoes');
		const meta = valueFrom('Metacritic');

		return {
			imdbId: real(data.imdbID),
			imdbRating: toNumber(real(data.imdbRating)),
			imdbVotes: toNumber(real(data.imdbVotes)),
			rtScore: rt ? toNumber(rt.replace('%', '')) : null,
			metascore: meta ? toNumber(meta.split('/')[0]) : toNumber(real(data.Metascore)),
			contentRating: real(data.Rated),
			awards: real(data.Awards)
		};
	} catch {
		return EMPTY_SCORES;
	}
}
