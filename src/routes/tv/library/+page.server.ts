import { tvLibrary } from '$lib/server/db/queries';
import { isWatched } from '$lib/constants';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const status = url.searchParams.get('status') ?? '';
	const library = tvLibrary();
	// "Watched" takes in Rewatching and Caught up too.
	const shown = (item: { status: string }) => (status === 'completed' ? isWatched(item.status) : item.status === status);
	return { status, items: status ? library.filter(shown) : library };
};
