/**
 * Whether something can be watched: on Showbox, or (anime) on another source.
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
import { getOrderCache, saveOrderCache } from './db/queries';

const HOUR = 60 * 60 * 1000;
const underWay = new Map<string, Promise<boolean>>();

async function onShowbox(title: string, type: string, year: string): Promise<boolean> {
	const results = await searchShowbox(title);
	if (results.length && bestMatch(results, title, type, year)) return true;

	const altTitles: string[] = [];
	const tmdbType = type === 'movie' ? ('movie' as const) : ('tv' as const);
	altTitles.push(...(await fetchAlternativeTitles(title, tmdbType)));
	if (type === 'tv' || !type) {
		const romaji = await fetchRomajiTitle(title);
		if (romaji && !altTitles.includes(romaji)) altTitles.push(romaji);
	}
	const wordsOf = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((w) => w.length > 1);
	const origWords = new Set(wordsOf(title));
	for (const alt of altTitles) {
		const candidate = await searchShowbox(alt);
		const best = candidate.length > 0 ? bestMatch(candidate, alt, type, year) : null;
		if (!best) continue;
		if (wordsOf(best.title).some((w) => origWords.has(w)) || wordsOf(alt).some((w) => origWords.has(w))) return true;
	}
	return false;
}

async function onOtherSource(title: string, type: string, year: string): Promise<boolean> {
	if (type === 'movie') return Boolean(await aniwaveFilm(title, year));
	const show = await tmdbShow(title.replace(/\s+(season|s)\s*\d+\s*$/i, '').trim(), '');
	if (!show?.anime) return false;
	return (await aniwaveFiles(show, title)).size > 0;
}

/** True as soon as one says yes; false once all have said no. */
function firstYes(checks: Promise<boolean>[]): Promise<boolean> {
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

export function isAvailable(title: string, type: string, year: string): Promise<boolean> {
	const key = `available|${title.toLowerCase()}|${type}|${year}`;
	const known = getOrderCache(key);
	if (known && Date.now() - known.at < (known.value ? 24 * HOUR : HOUR)) return Promise.resolve(Boolean(known.value));

	const running = underWay.get(key);
	if (running) return running;
	const check = firstYes([onShowbox(title, type, year), onOtherSource(title, type, year)]).then((yes) => {
		saveOrderCache(key, yes, Date.now());
		underWay.delete(key);
		return yes;
	});
	underWay.set(key, check);
	return check;
}
