import { fetchDetails } from './metadata/details';
import { saveProfileTitle } from './db/queries';

/**
 * A title put on someone's own list (a TV profile that isn't the library's owner), looked up
 * the same way the library looks it up. Returns its id on their list, or null if nothing's found.
 */
export async function addProfileTitleFromSource(
	source: string,
	sourceId: string,
	status: string,
	reached: { season?: number | null; episode?: number | null } = {}
): Promise<number | null> {
	const details = await fetchDetails(source, sourceId).catch(() => null);
	if (!details?.title) return null;
	return saveProfileTitle({
		source,
		sourceId,
		title: details.title,
		year: details.year,
		category: details.categorySlug,
		posterUrl: details.posterUrl,
		overview: details.overview,
		// Not out yet can only be wanted (as in the library: createFromResult).
		status: details.unreleased ? 'planned' : status,
		lastSeason: reached.season ?? null,
		lastEpisode: reached.episode ?? null
	});
}
