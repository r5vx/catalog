/**
 * Works out whether a series has moved on since you last watched it.
 *
 * Shared by the server and the pages, so it takes plain values rather than a
 * database row.
 */
export type ProgressInput = {
	lastSeason: number | null;
	lastEpisode: number | null;
	episodesTotal: number | null;
	seasonCounts: string | null;
	showStatus: string | null;
};

/** Episodes per season, as recorded at the last refresh. */
function parseCounts(json: string | null): Record<string, number> | null {
	if (!json) return null;
	try {
		const parsed = JSON.parse(json);
		return parsed && typeof parsed === 'object' ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * How many episodes you haven't seen, or null when we can't say — which is the
 * honest answer for anything you never recorded a position on.
 */
export function episodesBehind(entry: ProgressInput): number | null {
	const { lastSeason, lastEpisode, episodesTotal } = entry;

	if (!episodesTotal) return null;
	if (lastSeason === null && lastEpisode === null) return null;

	const counts = parseCounts(entry.seasonCounts);

	// No per-season breakdown (anime is listed one season at a time), so the
	// episode number alone is the position.
	if (!counts || lastSeason === null) {
		if (lastEpisode === null) return null;
		return Math.max(0, episodesTotal - lastEpisode);
	}

	// Add up whole seasons you finished, then the episodes into the current one.
	let watched = 0;
	for (const [season, episodes] of Object.entries(counts)) {
		if (Number(season) < lastSeason) watched += episodes;
	}
	watched += lastEpisode ?? counts[String(lastSeason)] ?? 0;

	return Math.max(0, episodesTotal - watched);
}

/** A short line for the entry page: what's waiting, and whether more is coming. */
export function progressSummary(entry: ProgressInput & { nextAirDate?: string | null }): string {
	const behind = episodesBehind(entry);
	const ended = /ended|canceled|cancelled/i.test(entry.showStatus ?? '');

	if (behind === null) {
		return entry.showStatus ? `${entry.showStatus}.` : '';
	}

	const waiting =
		behind === 0 ? "You're caught up" : `${behind} episode${behind === 1 ? '' : 's'} waiting`;

	if (ended) return `${waiting}. The show has finished.`;
	if (entry.nextAirDate) return `${waiting}. Next episode ${entry.nextAirDate}.`;

	return `${waiting}. Still running.`;
}
