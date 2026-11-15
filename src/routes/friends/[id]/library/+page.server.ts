import { error } from '@sveltejs/kit';
import { cloud, onlineConnected } from '$lib/server/online';
import { currentProfile } from '$lib/server/profile';
import type { PageServerLoad } from './$types';

/** A friend's library as the meeting point has it: everything they've watched (their Catalog sends it). */
export const load: PageServerLoad = async ({ params }) => {
	if (!/^[A-Z0-9]{16}$/.test(params.id)) error(404, 'No such person');
	if (!onlineConnected()) error(404, "This Catalog isn't online");
	const profile = await cloud<{ id: string; name: string; avatar: number; me: boolean }>(`/v1/people/${params.id}/profile`, { profile: currentProfile() });
	if (!profile.ok || !profile.data) error(profile.status === 403 ? 403 : 502, profile.error || "Couldn't open that library");
	return { person: { id: profile.data.id, name: profile.data.name, avatar: profile.data.avatar, me: profile.data.me } };
};
