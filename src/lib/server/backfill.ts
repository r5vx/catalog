import { db } from './db';
import { getEntry, saveScores, saveOverview, saveFacts } from './db/queries';
import { setTags } from './db/tags';
import { setCast } from './db/people';
import { fetchDetails } from './metadata/details';
import { fetchScores, omdbConfigured } from './metadata/omdb';

/**
 * Filling in what the search results never carried.
 *
 * Adding a title by search stores what the *search* endpoint returns, and that
 * has no runtime, no IMDb score and no box office. Those come from the detail
 * endpoints, which used to be asked only for tags and cast — so sorting by
 * "Longest" had nothing to sort and sorting by a score covered whatever
 * handful of titles you happened to have opened.
 *
 * This walks the library once and asks for the rest. It starts on its own a
 * few seconds after the app opens — it's hundreds of API calls, but they only
 * happen once and nobody should have to know to press a button to make sorting
 * by runtime work.
 */

export type BackfillState = {
	status: 'idle' | 'working' | 'done' | 'failed';
	done: number;
	total: number;
	label: string;
	message?: string;
};

let state: BackfillState = { status: 'idle', done: 0, total: 0, label: '' };

export const backfillState = (): BackfillState => state;

/**
 * What still needs asking about.
 *
 * "Missing a runtime" is not the same as "nobody has looked". A short film, a
 * series TMDB has no episode length for, anything OMDb has never heard of —
 * those come back empty however many times you ask, and counting them as
 * outstanding meant the number never reached zero. Once a lookup has happened
 * the stamp says so, and the title is left alone.
 */
const OUTSTANDING = `
	source_id IS NOT NULL
	AND (
		(details_checked_at IS NULL
			AND (runtime_minutes IS NULL OR overview IS NULL OR overview = ''))
		%SCORES%
	)
`;

/** The same condition, with the scores half included only when OMDb can answer. */
const outstanding = () =>
	OUTSTANDING.replace('%SCORES%', omdbConfigured() ? 'OR scores_checked_at IS NULL' : '');

/** How many entries are still missing something worth having. */
export function missingCount(): number {
	return (
		db.prepare(`SELECT COUNT(*) AS n FROM entries WHERE ${outstanding()}`).get() as { n: number }
	).n;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Gentle on the APIs — a few hundred calls shouldn't look like an attack. */
const BETWEEN_CALLS = 120;

export function startBackfill(): boolean {
	if (state.status === 'working') return true;

	const ids = (
		db.prepare(`SELECT id FROM entries WHERE ${outstanding()} ORDER BY id`).all() as {
			id: number;
		}[]
	).map((row) => row.id);

	state = { status: 'working', done: 0, total: ids.length, label: 'Starting…' };

	if (ids.length === 0) {
		state = { status: 'done', done: 0, total: 0, label: '', message: 'Nothing was missing.' };
		return true;
	}

	// Deliberately not awaited: the request returns and the page polls.
	run(ids);
	return true;
}

async function run(ids: number[]) {
	// Titles that gained something, and titles the databases simply had
	// nothing more for. The second number is the interesting one: it's why
	// the count used to sit at 44 no matter how many times you pressed go.
	let gained = 0;
	let empty = 0;
	let unreachable = 0;

	for (const [index, id] of ids.entries()) {
		if (state.status !== 'working') return;

		const entry = getEntry(id);
		if (!entry?.sourceId) {
			state = { ...state, done: index + 1 };
			continue;
		}

		state = { ...state, done: index, label: entry.title };

		let better = false;
		// A title nobody could reach is not a title with nothing to give, and
		// the finishing message shouldn't claim otherwise after an offline run.
		let reached = true;

		try {
			if (entry.detailsCheckedAt == null && (entry.runtimeMinutes == null || !entry.overview)) {
				const details = await fetchDetails(entry.source, entry.sourceId);

				if (details.title) {
					if (details.overview && !entry.overview) {
						saveOverview(id, details.overview);
						better = true;
					}
					if (details.tags.length > 0) setTags(id, details.tags);
					if (details.cast.length > 0) setCast(id, details.cast);

					saveFacts(id, {
						runtimeMinutes: details.runtimeMinutes,
						episodesTotal: details.episodesTotal,
						// Asked and answered — even an answer with no runtime in it.
						checked: true
					});

					if (entry.runtimeMinutes == null && details.runtimeMinutes != null) better = true;
				} else {
					reached = false;
				}

				await pause(BETWEEN_CALLS);
			}

			if (omdbConfigured() && !entry.scoresCheckedAt) {
				const fresh = await fetchScores({
					imdbId: getEntry(id)?.imdbId ?? entry.imdbId,
					title: entry.title,
					year: entry.year,
					isSeries: Boolean(entry.episodesTotal)
				});

				// null means we couldn't ask — don't record that as checked.
				if (fresh) {
					saveScores(id, fresh);
					if (fresh.imdbRating != null || fresh.rtScore != null || fresh.metascore != null) {
						better = true;
					}
				} else {
					reached = false;
				}

				await pause(BETWEEN_CALLS);
			}
		} catch {
			// One title failing shouldn't stop the other three hundred.
			reached = false;
		}

		if (better) gained += 1;
		else if (reached) empty += 1;
		else unreachable += 1;

		state = { ...state, done: index + 1 };
	}

	state = {
		status: 'done',
		done: ids.length,
		total: ids.length,
		label: '',
		message: summarise(gained, empty, unreachable)
	};
}

/**
 * What to say when it finishes.
 *
 * "Filled in 0 runtimes" reads like a failure when it usually isn't — the
 * databases have nothing for some titles and never will. Saying so, once,
 * is better than a zero that looks broken.
 */
function summarise(gained: number, empty: number, unreachable: number): string {
	const titles = (n: number) => `${n} title${n === 1 ? '' : 's'}`;

	const parts: string[] = [];

	if (gained > 0) parts.push(`Filled in ${titles(gained)}.`);

	if (empty > 0) {
		parts.push(
			gained > 0
				? `The other ${empty} had nothing more to give, so they won't be asked about again.`
				: `Checked ${titles(empty)} — the databases had nothing more for them, so they won't be asked about again.`
		);
	}

	// Worth saying plainly: these will be tried again, and nothing was lost.
	if (unreachable > 0) parts.push(`${titles(unreachable)} couldn't be reached, and will be retried.`);

	return parts.join(' ') || 'Nothing was missing.';
}

/* ------------------------------------------------------------- on its own */

/** So a reload of this module in dev doesn't queue a second run. */
let scheduled = false;

/**
 * Begins filling things in shortly after the app starts.
 *
 * Delayed rather than immediate so opening Catalog stays instant — the first
 * seconds belong to the library rendering, not to three hundred lookups. It
 * does nothing when there is nothing missing, which is the usual case.
 */
export function scheduleBackfill(delayMs = 8000): void {
	if (scheduled) return;
	scheduled = true;

	const timer = setTimeout(() => {
		try {
			if (missingCount() > 0) startBackfill();
		} catch {
			// A library that will not open has bigger problems than runtimes.
		}
	}, delayMs);

	// Never hold the process open for this.
	timer.unref?.();
}
