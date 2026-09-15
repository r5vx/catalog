import { json } from '@sveltejs/kit';
import { searchAll, hasTmdbKey } from '$lib/server/metadata';
import { parseTitle } from '$lib/parseTitle';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	// Typing "Fantastic Four (2005)" into the box should work exactly as well
	// as typing it into the importer, so the same parser handles both.
	const { title, year } = parseTitle(url.searchParams.get('q') ?? '');
	const results = await searchAll(title, { year });

	return json({ results, tmdbEnabled: hasTmdbKey() });
};
