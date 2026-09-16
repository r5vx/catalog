import {
	getPerson,
	getPersonBySourceId,
	entriesWithPerson,
	allTitleKeys
} from '$lib/server/db/people';
import { fetchKnownFor, fetchPerson } from '$lib/server/metadata/details';
import { safeBack } from '$lib/back';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Someone's page, whether or not they're in your library.
 *
 * `[id]` is either our own numeric id, or the provider's — `tmdb:2231`. The
 * second form is what lets the cast of a film you *don't* own be clickable:
 * those people have no row here, so there is no number to link to, and every
 * one of them used to be a dead end.
 */
export const load: PageServerLoad = async ({ params, url }) => {
	const numeric = /^\d+$/.test(params.id);

	const person = numeric ? getPerson(Number(params.id)) : getPersonBySourceId(params.id);

	// Someone we've never stored: ask the provider who they are.
	const resolved = person ?? {
		id: 0,
		sourceId: params.id,
		...((await fetchPerson(params.id)) ?? { name: '', photo: null })
	};

	if (!resolved.name) error(404, 'No one by that name here.');

	const yours = resolved.id ? entriesWithPerson(resolved.id) : [];
	const owned = allTitleKeys();
	const normalise = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

	const knownFor = (await fetchKnownFor(resolved.sourceId)).filter(
		(credit: { title: string }) => !owned.has(normalise(credit.title))
	);

	return {
		person: resolved,
		entries: yours,
		knownFor,
		// Set when you arrived from a film, so "back" returns there.
		back: safeBack(url.searchParams.get('back'))
	};
};
