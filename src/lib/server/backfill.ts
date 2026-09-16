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
 * This walks the library once and asks for the rest. It's deliberately a
 * button rather than something automatic: it's hundreds of API calls.
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

/** How many entries are still missing something worth having. */
export function missingCount(): number {
	const scores = omdbConfigured() ? ' OR scores_checked_at IS NULL' : '';

	return (
		db
			.prepare(
				`SELECT COUNT(*) AS n FROM entries
				 WHERE source_id IS NOT NULL
				   AND (runtime_minutes IS NULL OR overview IS NULL OR overview = ''${scores})`
			)
			.get() as { n: number }
	).n;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Gentle on the APIs — a few hundred calls shouldn't look like an attack. */
const BETWEEN_CALLS = 120;

export function startBackfill(): boolean {
	if (state.status === 'working') return true;

	const scores = omdbConfigured() ? ' OR scores_checked_at IS NULL' : '';

	const ids = (
		db
			.prepare(
				`SELECT id FROM entries
				 WHERE source_id IS NOT NULL
				   AND (runtime_minutes IS NULL OR overview IS NULL OR overview = ''${scores})
				 ORDER BY id`
			)
			.all() as { id: number }[]
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
	let filled = 0;

	for (const [index, id] of ids.entries()) {
		if (state.status !== 'working') return;

		const entry = getEntry(id);
		if (!entry?.sourceId) {
			state = { ...state, done: index + 1 };
			continue;
		}

		state = { ...state, done: index, label: entry.title };

		try {
			if (entry.runtimeMinutes == null || !entry.overview) {
				const details = await fetchDetails(entry.source, entry.sourceId);

				if (details.title) {
					if (details.overview && !entry.overview) saveOverview(id, details.overview);
					if (details.tags.length > 0) setTags(id, details.tags);
					if (details.cast.length > 0) setCast(id, details.cast);

					saveFacts(id, {
						runtimeMinutes: details.runtimeMinutes,
						episodesTotal: details.episodesTotal
					});

					if (details.runtimeMinutes != null) filled += 1;
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
				if (fresh) saveScores(id, fresh);

				await pause(BETWEEN_CALLS);
			}
		} catch {
			// One title failing shouldn't stop the other three hundred.
		}

		state = { ...state, done: index + 1 };
	}

	state = {
		status: 'done',
		done: ids.length,
		total: ids.length,
		label: '',
		message: `Filled in ${filled} runtime${filled === 1 ? '' : 's'} across ${ids.length} titles.`
	};
}
