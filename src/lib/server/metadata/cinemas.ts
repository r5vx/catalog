/**
 * Films only in cinemas so far. TMDB lists each film's release dates by kind, country by country:
 * 1 premiere, 2 limited and 3 cinema, then 4 digital, 5 disc and 6 TV, the ways to watch at home.
 * Until one of those, the sources only have recordings made in a cinema, or a page with nothing
 * on it: Clayface (in US cinemas 23 October 2026) had a Showbox page with no files and a 720p
 * recording on 7Movies, and showed "Watch" (and Movy was searched for 50 s).
 */
import { tmdbGet } from './tmdb';

export type ReleaseDate = { type: number; release_date: string };

/** How long after its cinema release a film counts as out, when TMDB has no date for home. */
const USUAL_WAIT_DAYS = 45;

/**
 * Null when a film can be watched at home (or nothing says otherwise). Otherwise when it can:
 * its date (YYYY-MM-DD), or '' while not known.
 */
export function onlyInCinemas(dates: ReleaseDate[], now = Date.now()): string | null {
	const day = (d: ReleaseDate) => d.release_date.slice(0, 10);
	const today = new Date(now).toISOString().slice(0, 10);
	const home = dates.filter((d) => d.type >= 4).map(day).sort()[0];
	if (home && home <= today) return null;
	const cinema = dates.filter((d) => d.type === 2 || d.type === 3).map(day).sort()[0];
	if (!cinema) return home ?? null;
	if (home) return home;
	const usual = new Date(Date.parse(`${cinema}T00:00:00Z`) + USUAL_WAIT_DAYS * 86400_000).toISOString().slice(0, 10);
	return usual <= today ? null : '';
}

/** Every country's release dates, as the film's TMDB record has them under `release_dates`. */
export function allDates(releaseDates: { results?: { release_dates?: ReleaseDate[] }[] } | undefined): ReleaseDate[] {
	return (releaseDates?.results ?? []).flatMap((country) => country.release_dates ?? []);
}

/** onlyInCinemas for TMDB film `id`, asked separately (the Watch check has only the film's name). */
export async function filmOnlyInCinemas(id: number): Promise<string | null> {
	const answer = await tmdbGet<{ results?: { release_dates?: ReleaseDate[] }[] }>(`/movie/${id}/release_dates`);
	return answer ? onlyInCinemas(allDates(answer)) : null;
}
