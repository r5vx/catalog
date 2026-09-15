import { getPerson, entriesWithPerson, allTitleKeys } from '$lib/server/db/people';
import { fetchKnownFor } from '$lib/server/metadata/details';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const person = getPerson(Number(params.id));
	if (!person) error(404, 'No one by that name here.');

	const yours = entriesWithPerson(person.id);
	const owned = allTitleKeys();
	const normalise = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

	const knownFor = (await fetchKnownFor(person.sourceId)).filter(
		(credit: { title: string }) => !owned.has(normalise(credit.title))
	);

	// Set when you arrived from a film's cast list, so "back" returns there.
	const from = Number(url.searchParams.get('from')) || null;

	return { person, entries: yours, knownFor, from };
};
