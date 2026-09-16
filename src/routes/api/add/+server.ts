import { json, error } from '@sveltejs/kit';
import { addFromSource } from '$lib/server/entries';
import { STATUSES } from '$lib/constants';
import type { RequestHandler } from './$types';

/**
 * Put a title in the library without leaving the page you're on.
 *
 * Browsing and reading someone else's list are both "I've found something" —
 * being sent off to a search box to find what's already on screen is the
 * wrong shape for that, so the card does it where it stands.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { source, sourceId, status } = await request.json();

	if (!source || !sourceId) error(400, 'Nothing to add.');

	// Never trust a status off the wire into the database.
	const wanted = STATUSES.some((one) => one.value === status) ? status : 'planned';

	const added = await addFromSource(String(source), String(sourceId), wanted);

	if (!added) error(502, 'Could not reach the database for that title.');

	return json(added);
};
