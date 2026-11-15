import { error } from '@sveltejs/kit';
import { cloud, onlineConnected } from '$lib/server/online';
import { currentProfile } from '$lib/server/profile';
import type { PageServerLoad } from './$types';

/** A friend's profile, or your own (src/routes/friends/[id]/+page.svelte), from the meeting point. */
export type Titled = { key: string; title: string; year: string; type: string; poster: string; rating?: number | null; at?: number; season?: number; episode?: number };
export type Profile = {
	id: string;
	name: string;
	avatar: number;
	joined: number;
	me: boolean;
	friendsSince: number | null;
	bio: string;
	color: string;
	favorites: Titled[];
	counts: { total: number; films: number; shows: number; rated: number };
	top: Titled[];
	recent: Titled[];
	watching: { title: string; type: 'tv' | 'movie'; year: string; season: number; episode: number; poster: string; room?: string } | null;
	mutual: number;
};

export const load: PageServerLoad = async ({ params }) => {
	if (!/^[A-Z0-9]{16}$/.test(params.id)) error(404, 'No such person');
	if (!onlineConnected()) error(404, "This Catalog isn't online");
	const answer = await cloud<Profile>(`/v1/people/${params.id}/profile`, { profile: currentProfile() });
	if (!answer.ok || !answer.data) error(answer.status === 403 ? 403 : answer.status === 404 ? 404 : 502, answer.error || "Couldn't open that profile");
	return { profile: answer.data };
};
