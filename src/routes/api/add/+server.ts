import { json, error } from '@sveltejs/kit';
import { addFromSource } from '$lib/server/entries';
import { STATUSES } from '$lib/constants';
import { currentProfile, MAIN_PROFILE } from '$lib/server/profile';
import { addProfileTitleFromSource } from '$lib/server/profileTitles';
import { searchAll } from '$lib/server/metadata';
import type { RequestHandler } from './$types';

/**
 * A title known only by its name, year and kind (what a friend is watching: their Catalog says
 * no more): TMDB's best match. Null when nothing fits.
 */
async function findByName(title: string, year: string, type: string): Promise<{ source: string; sourceId: string } | null> {
	const found = await searchAll(title, { year: Number(year) || null, limit: 8 });
	const film = type === 'movie';
	const fits = found.filter((one) => (film ? one.categorySlug === 'movies' : one.categorySlug !== 'movies'));
	const sameName = (one: { title: string }) => one.title.toLowerCase() === title.toLowerCase();
	const best = fits.find((one) => sameName(one) && (!year || String(one.year) === year)) ?? fits.find(sameName) ?? fits[0];
	return best ? { source: best.source, sourceId: best.sourceId } : null;
}

/**
 * Put a title in the library without leaving the page you're on.
 *
 * Browsing and reading someone else's list are both "I've found something" —
 * being sent off to a search box to find what's already on screen is the
 * wrong shape for that, so the card does it where it stands.
 */
export const POST: RequestHandler = async ({ request }) => {
	const sent = await request.json();
	let { source, sourceId } = sent;
	const { status } = sent;

	// Only a name (a friend's "Watching now", a room's film): found by it first.
	if ((!source || !sourceId) && typeof sent.title === 'string' && sent.title.trim()) {
		const found = await findByName(sent.title.trim(), String(sent.year ?? ''), String(sent.type ?? ''));
		if (!found) error(404, "Couldn't find that title");
		({ source, sourceId } = found);
	}

	if (!source || !sourceId) error(400, 'Nothing to add.');

	// Never trust a status off the wire into the database.
	const wanted = STATUSES.some((one) => one.value === status) ? status : 'planned';

	// Someone else's profile on the TV: their own list, not the library.
	if (currentProfile() !== MAIN_PROFILE) {
		const id = await addProfileTitleFromSource(String(source), String(sourceId), wanted);
		if (!id) error(502, 'Could not reach the database for that title.');
		return json({ id });
	}

	const added = await addFromSource(String(source), String(sourceId), wanted);

	if (!added) error(502, 'Could not reach the database for that title.');

	return json(added);
};
