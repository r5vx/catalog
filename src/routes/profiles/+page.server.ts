import { listProfiles } from '$lib/server/db/queries';
import { currentProfile } from '$lib/server/profile';
import type { PageServerLoad } from './$types';

/** Everyone in the house, who this device watches as now, and where to go once one is picked. */
export const load: PageServerLoad = async ({ url, cookies }) => {
	const next = url.searchParams.get('next') ?? '/';
	return {
		profiles: listProfiles(),
		// Nobody highlighted the first time.
		current: cookies.get('catalog_profile') !== undefined ? currentProfile() : null,
		// Only a page of this Catalog (never another site).
		next: next.startsWith('/') && !next.startsWith('//') ? next : '/'
	};
};
