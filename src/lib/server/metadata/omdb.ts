import { env } from '$env/dynamic/private';
import { readSettings } from '../settings';
import { parseOmdb, real, EMPTY_SCORES, type Scores } from './omdbParse';

/**
 * Scores from everywhere that isn't TMDB.
 *
 * TMDB publishes its own rating and nothing else — no IMDb number, no Rotten
 * Tomatoes, no Metacritic. OMDb is the one free source carrying all three in a
 * single response, along with the age rating, awards and box office.
 *
 * It's optional. Without a key the app works exactly as before and the extra
 * scores simply don't appear.
 *
 * Reading the response lives in `omdbParse.ts`, which imports nothing, so it
 * can be tested without a key or a network.
 */

export type { Scores };
export { EMPTY_SCORES };

const omdbKey = () => (readSettings().omdbApiKey || env.OMDB_API_KEY || '').trim();

export const omdbConfigured = () => Boolean(omdbKey());

/** Checks a key before it's saved, so a typo is caught immediately. */
export async function verifyOmdbKey(key: string): Promise<{ ok: boolean; message: string }> {
	try {
		const url = new URL('https://www.omdbapi.com/');
		url.searchParams.set('apikey', key.trim());
		url.searchParams.set('i', 'tt0111161'); // The Shawshank Redemption

		const response = await fetch(url);

		// A bad key comes back 401 with the reason in the body — "Invalid API
		// key!", or "No API key provided." — so read it either way rather than
		// reporting a status code at someone.
		const data = await response.json().catch(() => null);
		const problem = real(data?.Error);

		if (problem) return { ok: false, message: problem };
		if (!response.ok) return { ok: false, message: `OMDb said ${response.status}.` };
		if (data?.Response === 'False') return { ok: false, message: 'OMDb rejected that key.' };

		return { ok: true, message: 'Key saved. Extra scores are on.' };
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
 *
 * **Returns null when it couldn't ask** — no key, rejected key, daily limit
 * reached, or offline — as opposed to `EMPTY_SCORES`, which means it asked and
 * OMDb has nothing. The caller must not record a failed ask as "checked", or
 * fixing the key later would change nothing for a month.
 */
export async function fetchScores(lookup: {
	imdbId?: string | null;
	title?: string | null;
	year?: number | null;
	isSeries?: boolean;
}): Promise<Scores | null> {
	const key = omdbKey();
	if (!key) return null;

	const url = new URL('https://www.omdbapi.com/');
	url.searchParams.set('apikey', key);

	if (lookup.imdbId) {
		url.searchParams.set('i', lookup.imdbId);
	} else if (lookup.title) {
		url.searchParams.set('t', lookup.title);
		if (lookup.year) url.searchParams.set('y', String(lookup.year));
		if (lookup.isSeries) url.searchParams.set('type', 'series');
	} else {
		// Nothing to look it up by. That's an answer, not a failure.
		return EMPTY_SCORES;
	}

	try {
		const response = await fetch(url);

		// 401 is a bad key or the daily limit; both mean "ask again later".
		if (!response.ok) return null;

		return parseOmdb(await response.json());
	} catch {
		return null;
	}
}
