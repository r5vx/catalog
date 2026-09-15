import { json, error } from '@sveltejs/kit';
import { getEntry, saveScores, saveOverview } from '$lib/server/db/queries';
import { setTags, tagsForEntry } from '$lib/server/db/tags';
import { setCast, castForEntry } from '$lib/server/db/people';
import { fetchDetails } from '$lib/server/metadata/details';
import { fetchScores, omdbConfigured } from '$lib/server/metadata/omdb';
import type { RequestHandler } from './$types';

/** How long a stored score is trusted before it's looked up again. */
const FRESH_FOR_DAYS = 30;

const isStale = (stamp: string | null) =>
	!stamp || Date.now() - new Date(stamp).getTime() > FRESH_FOR_DAYS * 86_400_000;

/**
 * Fills in everything the entry page wants but the library doesn't store:
 * outside scores, and — for entries added before we kept one — the synopsis,
 * tags and cast.
 *
 * The page renders first and calls this afterwards, so a slow API never holds
 * up the page. Results are saved, so it only ever happens once.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { id } = await request.json();
	const entry = getEntry(Number(id));
	if (!entry) error(404, 'No such entry.');

	// Older entries predate the synopsis, the tags and the cast list. If any of
	// them is missing, this is the moment to go and get it.
	const needsDetails = !entry.overview;

	if (needsDetails && entry.sourceId) {
		const details = await fetchDetails(entry.source, entry.sourceId);

		if (details.overview) saveOverview(entry.id, details.overview);
		if (details.tags.length > 0) setTags(entry.id, details.tags);
		if (details.cast.length > 0) setCast(entry.id, details.cast);

		// AniList has no IMDb id, so OMDb is asked by name instead.
		if (!entry.imdbId && details.imdbId) entry.imdbId = details.imdbId;
	}

	let scores = {
		imdbId: entry.imdbId,
		imdbRating: entry.imdbRating,
		imdbVotes: entry.imdbVotes,
		rtScore: entry.rtScore,
		metascore: entry.metascore,
		contentRating: entry.contentRating,
		awards: entry.awards
	};

	if (omdbConfigured() && isStale(entry.scoresCheckedAt)) {
		const fresh = await fetchScores({
			imdbId: entry.imdbId,
			title: entry.title,
			year: entry.year,
			isSeries: Boolean(entry.episodesTotal)
		});

		// A lookup that found nothing still counts as checked — otherwise every
		// page view would ask again for something OMDb has never heard of.
		saveScores(entry.id, fresh);
		scores = fresh;
	}

	const updated = getEntry(entry.id);

	// Tags and cast come back too, so a page that just gained them can show
	// them without a reload — which would throw away anything half-typed in
	// the edit form.
	return json({
		scores,
		overview: updated?.overview ?? null,
		tags: tagsForEntry(entry.id),
		cast: castForEntry(entry.id),
		configured: omdbConfigured()
	});
};
