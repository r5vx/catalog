import { tvLibrary } from '$lib/server/db/queries';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const status = url.searchParams.get('status') ?? '';
	const library = tvLibrary();
	return { status, items: status ? library.filter((item) => item.status === status) : library };
};
