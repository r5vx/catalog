/**
 * Whether something can be watched: on Showbox, on 7Movies, or (anime) on Aniwave.
 *
 * Both are asked at once and the first "yes" answers, so the Watch button doesn't wait on the
 * slower one. Answers are kept (a "yes" for a day, a "no" for an hour), and a check already
 * under way is shared — the title page starts it while the page loads, and the button's own
 * request just picks it up.
 */
import { searchShowbox, bestMatch } from './showbox';
import { fetchAlternativeTitles } from './metadata/tmdb';
import { fetchRomajiTitle } from './metadata/anilist';
import { tmdbShow } from './combinedEpisodes';
import { aniwaveFiles, aniwaveFilm } from './sources';
import { onVidrift } from './sources/vidrift';
import { tmdbGet } from './metadata/tmdb';
import { getOrderCache, saveOrderCache } from './db/queries';

const HOUR = 60 * 60 * 1000;
const underWay = new Map<string, Promise<boolean>>();

async function onShowbox(title: string, type: string, year: string): Promise<boolean> {
	const results = await searchShowbox(title);
	if (results.length && bestMatch(results, title, type, year)) return true;

	// Its other names, all searched at once (one after another took most of a slow check).
	const tmdbType = type === 'movie' ? ('movie' as const) : ('tv' as const);
	const [alternatives, romaji] = await Promise.all([
		fetchAlternativeTitles(title, tmdbType),
		type === 'tv' || !type ? fetchRomajiTitle(title) : Promise.resolve(null)
	]);
	const altTitles = [...new Set([...alternatives, ...(romaji ? [romaji] : [])])];
	const wordsOf = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((w) => w.length > 1);
	const origWords = new Set(wordsOf(title));
	return firstYes(
		altTitles.map(async (alt) => {
			const candidate = await searchShowbox(alt);
			const best = candidate.length > 0 ? bestMatch(candidate, alt, type, year) : null;
			if (!best) return false;
			return wordsOf(best.title).some((w) => origWords.has(w)) || wordsOf(alt).some((w) => origWords.has(w));
		})
	);
}

async function onAniwave(title: string, type: string, year: string): Promise<boolean> {
	if (type === 'movie') return Boolean(await aniwaveFilm(title, year));
	const show = await tmdbShow(title.replace(/\s+(season|s)\s*\d+\s*$/i, '').trim(), '');
	if (!show?.anime) return false;
	return (await aniwaveFiles(show, title)).size > 0;
}

/** 7Movies goes by TMDB's id: a film's, or a show's first episode. */
async function on7Movies(title: string, type: string, year: string): Promise<boolean> {
	if (type === 'movie') {
		type Found = { results: { id: number; title?: string }[] };
		const found = await tmdbGet<Found>('/search/movie', { query: title, ...(year ? { year } : {}) });
		const film = found?.results.find((r) => r.title?.toLowerCase() === title.toLowerCase()) ?? found?.results[0];
		return film ? onVidrift({ type: 'movie', id: film.id }) : false;
	}
	const show = await tmdbShow(title.replace(/\s+(season|s)\s*\d+\s*$/i, '').trim(), '');
	return show ? onVidrift({ type: 'tv', id: show.id, season: 1, episode: 1 }) : false;
}

/** True as soon as one says yes; false once all have said no. */
function firstYes(checks: Promise<boolean>[]): Promise<boolean> {
	if (!checks.length) return Promise.resolve(false);
	return new Promise((resolve) => {
		let left = checks.length;
		for (const check of checks) {
			check
				.catch(() => false)
				.then((yes) => {
					if (yes) resolve(true);
					else if (--left === 0) resolve(false);
				});
		}
	});
}

/** How long the Watch button's check waits before saying "not available" for now. */
const LIMIT = 12_000;

/**
 * Whether it can be watched; `unsure` when no source had said yes within 12 seconds. The check
 * carries on then and keeps its real answer, so asking again a little later gets it — a slow
 * 7Movies lookup kept "Checking availability…" up for 20 seconds or more (She-Beast).
 */
export async function isAvailable(title: string, type: string, year: string): Promise<{ available: boolean; unsure?: boolean }> {
	const key = `available|${title.toLowerCase()}|${type}|${year}`;
	const known = getOrderCache(key);
	if (known && Date.now() - known.at < (known.value ? 24 * HOUR : HOUR)) return { available: Boolean(known.value) };

	let check = underWay.get(key);
	if (!check) {
		check = firstYes([onShowbox(title, type, year), onAniwave(title, type, year), on7Movies(title, type, year)]).then((yes) => {
			saveOrderCache(key, yes, Date.now());
			underWay.delete(key);
			return yes;
		});
		underWay.set(key, check);
	}
	const late = Symbol('late');
	const answer = await Promise.race([check, new Promise<typeof late>((r) => setTimeout(() => r(late), LIMIT))]);
	return answer === late ? { available: false, unsure: true } : { available: answer };
}
