/**
 * Whether something can be watched: on Showbox, on 7Movies, on Movy, or (anime) on Aniwave.
 *
 * All are asked at once and the first "yes" answers, so the Watch button doesn't wait on the
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
import { onMovy, type Wanted } from './sources/movy';
import { tmdbGet } from './metadata/tmdb';
import { getOrderCache, saveOrderCache } from './db/queries';

const HOUR = 60 * 60 * 1000;
const underWay = new Map<string, Promise<boolean>>();

/** Where each source's check is at, for the Watch button to show while it waits. */
export type SourceCheck = { name: string; state: 'checking' | 'yes' | 'no' };
const progress = new Map<string, SourceCheck[]>();

/** A source's check, noted in `list` as it goes. */
function noted(list: SourceCheck[], name: string, check: Promise<boolean>): Promise<boolean> {
	const entry: SourceCheck = { name, state: 'checking' };
	list.push(entry);
	return check
		.catch(() => false)
		.then((yes) => {
			entry.state = yes ? 'yes' : 'no';
			return yes;
		});
}

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

/** What 7Movies and Movy are asked about: by TMDB's id, a film or a show's first episode. */
async function byTmdbId(title: string, type: string, year: string) {
	if (type === 'movie') {
		type Found = { results: { id: number; title?: string }[] };
		const found = await tmdbGet<Found>('/search/movie', { query: title, ...(year ? { year } : {}) });
		const film = found?.results.find((r) => r.title?.toLowerCase() === title.toLowerCase()) ?? found?.results[0];
		return film ? { type: 'movie' as const, id: film.id } : null;
	}
	const show = await tmdbShow(title.replace(/\s+(season|s)\s*\d+\s*$/i, '').trim(), '');
	return show ? { type: 'tv' as const, id: show.id, season: 1, episode: 1 } : null;
}

async function on7Movies(title: string, type: string, year: string): Promise<boolean> {
	const what = await byTmdbId(title, type, year);
	return what ? onVidrift(what) : false;
}

async function onMovyToo(title: string, type: string, year: string, wanted: Wanted): Promise<boolean> {
	const what = await byTmdbId(title, type, year);
	return what ? onMovy(what, wanted) : false;
}

/**
 * Which title's page asked last, and when each was last asked about: Movy's slow check carries
 * on for the title being looked at (so switching to Movy later is quick), and is called off once
 * another title is looked at — it used to hold its place for up to 75 s per title looked through.
 */
let latest = '';
const lastAsked = new Map<string, number>();
function asked(key: string) {
	latest = key;
	lastAsked.set(key, Date.now());
}
const stillOpen = (key: string) => key === latest || Date.now() - (lastAsked.get(key) ?? 0) < 6000;

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

	asked(key);
	const check = startCheck(key, title, type, year);
	const late = Symbol('late');
	const answer = await Promise.race([check, new Promise<typeof late>((r) => setTimeout(() => r(late), LIMIT))]);
	return answer === late ? { available: false, unsure: true } : { available: answer };
}

/** The check for a title: the one under way, or a new one with every source asked at once. */
function startCheck(key: string, title: string, type: string, year: string): Promise<boolean> {
	let check = underWay.get(key);
	if (check) return check;
	const list: SourceCheck[] = [];
	progress.set(key, list);
	const checks = [
		noted(list, 'Showbox', onShowbox(title, type, year)),
		noted(list, '7Movies', on7Movies(title, type, year)),
		noted(list, 'Aniwave', onAniwave(title, type, year)),
		noted(list, 'Movy', onMovyToo(title, type, year, {
			// Not started once another source has it, unless it's the title being looked at.
			start: () => key === latest || (stillOpen(key) && !list.some((s) => s.state === 'yes')),
			keep: () => stillOpen(key)
		}))
	];
	// The sources' progress stays until every one has answered, and a minute more for the page.
	Promise.allSettled(checks).then(() => setTimeout(() => progress.delete(key), 60_000));
	check = firstYes(checks).then((yes) => {
		saveOrderCache(key, yes, Date.now());
		underWay.delete(key);
		return yes;
	});
	underWay.set(key, check);
	return check;
}

/**
 * Where the check is at, straight away (the page asks every second while it waits):
 * `available` is null until a source says yes or all have said no; `sources` is each source's
 * progress meanwhile (empty when the answer was already known).
 */
export function availabilityNow(title: string, type: string, year: string): { available: boolean | null; sources: SourceCheck[] } {
	const key = `available|${title.toLowerCase()}|${type}|${year}`;
	asked(key);
	const known = getOrderCache(key);
	if (known && Date.now() - known.at < (known.value ? 24 * HOUR : HOUR) && !underWay.has(key)) {
		return { available: Boolean(known.value), sources: progress.get(key) ?? [] };
	}
	startCheck(key, title, type, year);
	const sources = progress.get(key) ?? [];
	const available = sources.some((s) => s.state === 'yes') ? true : sources.length && sources.every((s) => s.state === 'no') ? false : null;
	return { available, sources };
}

