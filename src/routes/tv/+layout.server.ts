import { listProfiles } from '$lib/server/db/queries';
import { currentProfile } from '$lib/server/profile';
import type { LayoutServerLoad } from './$types';

/** Everyone who watches on the TVs, and who's watching on this one. */
export const load: LayoutServerLoad = async () => {
	const profiles = listProfiles();
	const id = currentProfile();
	return { profiles, profile: profiles.find((one) => one.id === id) ?? profiles[0] };
};
