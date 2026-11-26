import { error, redirect } from '@sveltejs/kit';
import { cloud, keepMe, keepProfileAnswer, keptProfileAnswer, myAccount, onlineConnected } from '$lib/server/online';
import { currentProfile, MAIN_PROFILE } from '$lib/server/profile';
import { withNicknames } from '$lib/server/friendNicknames';
import { tmdbGet } from '$lib/server/metadata/tmdb';
import { entryIdsByKey, getOrderCache, saveOrderCache, topRatedEntries } from '$lib/server/db/queries';
import type { NameStyle } from '$lib/nameStyle';
import type { PageServerLoad } from './$types';

/** A friend's profile, or your own (src/routes/friends/[id]/+page.svelte), from the meeting point. */
export type Titled = { key: string; title: string; year: string; type: string; poster: string; rating?: number | null; at?: number; season?: number; episode?: number; /** Where it opens instead of the title's page: its library page, on your own profile. */ href?: string };
export type Profile = {
	id: string;
	name: string;
	avatar: number;
	joined: number;
	me: boolean;
	friendsSince: number | null;
	/** Their friend code, to give to someone else so they can add them (null: private, or an older meeting point). */
	code?: string | null;
	bio: string;
	color: string;
	/** How the name looks (null: plain), and the banner picture's number (0: none, the color instead). */
	nameStyle?: NameStyle | null;
	banner?: number;
	favorites: Titled[];
	counts: { total: number; films: number; shows: number; rated: number };
	top: Titled[];
	recent: Titled[];
	watching: { title: string; type: 'tv' | 'movie'; year: string; season: number; episode: number; poster: string; room?: string } | null;
	mutual: number;
	/** Their own name, when this profile has a nickname for them. */
	realName?: string;
	/** They keep their profile from friends (Settings → Online). */
	hidden?: boolean;
	/** Your own: what you keep from friends. */
	privacy?: { hideProfile: boolean; hideFriends: boolean };
	/** Some of what they've watched, when nothing else shows (made here, see below). */
	watched?: Titled[];
	/** Your own: Highest rated in films, shows and anime, from the library (friends' are asked for, ./top). */
	topKinds?: Record<'movie' | 'tv' | 'anime', Titled[]>;
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * A TMDB title's poster by its key ("tmdb:movie:603"), kept 30 days. A friend on an older
 * Catalog (4.2, 4.3) sends what they watched with no posters, so their profile showed
 * "12 watched" and nothing else (owner, 2026-11-15).
 */
async function posterOf(key: string): Promise<string> {
	const m = key.match(/^tmdb:(movie|tv):(\d+)$/);
	if (!m) return '';
	const kept = getOrderCache(`friend-poster|${key}`);
	if (kept && Date.now() - kept.at < 30 * DAY) return String(kept.value ?? '');
	const found = await tmdbGet<{ poster_path?: string | null }>(`/${m[1]}/${m[2]}`);
	if (!found) return '';
	const poster = found.poster_path ? `https://image.tmdb.org/t/p/w342${found.poster_path}` : '';
	saveOrderCache(`friend-poster|${key}`, poster, Date.now());
	return poster;
}

/** Up to 12 of what they've watched (best rated first), with posters filled in where missing. */
async function someWatched(id: string, profile: number): Promise<Titled[]> {
	const answer = await cloud<{ items?: Titled[] }>(`/v1/people/${id}/library`, { profile });
	const items = (answer.ok ? (answer.data?.items ?? []) : []).slice(0, 12);
	return Promise.all(
		items.map(async (item) => {
			const type = item.type || (item.key.startsWith('tmdb:movie:') ? 'movie' : item.key.startsWith('tmdb:tv:') ? 'tv' : '');
			return { ...item, type, poster: item.poster || (await posterOf(item.key).catch(() => '')) };
		})
	);
}

/** The profile as the meeting point has it, made ready for this page; throws the page's error when it can't be had. */
async function freshProfile(id: string): Promise<Profile> {
	const answer = await cloud<Profile>(`/v1/people/${id}/profile`, { profile: currentProfile() });
	if (!answer.ok || !answer.data) error(answer.status === 403 ? 403 : answer.status === 404 ? 404 : 502, answer.error || "Couldn't open that profile");
	if (answer.data.me) keepMe(currentProfile(), answer.data);
	const profile = withNicknames(currentProfile(), answer.data);
	// Your own profile, as the library's owner: Highest rated from the library itself (a new rating
	// used to show only after the next send, up to 10 minutes), and every title in the library opens
	// its library page, where it can be rated or changed (owner, 2026-11-16).
	if (profile.me && currentProfile() === MAIN_PROFILE) {
		const top = (kind: 'movie' | 'tv' | 'anime' | null) => topRatedEntries(12, kind).map(({ id, ...item }) => ({ ...item, href: `/entry/${id}` }));
		profile.top = top(null);
		profile.topKinds = { movie: top('movie'), tv: top('tv'), anime: top('anime') };
		const ids = entryIdsByKey();
		const inLibrary = (list: Titled[] | undefined) =>
			list?.map((item) => {
				const id = ids.get(item.key);
				return id ? { ...item, href: `/entry/${id}` } : item;
			});
		profile.favorites = inLibrary(profile.favorites) ?? [];
		profile.recent = inLibrary(profile.recent) ?? [];
	}
	if (!profile.hidden && profile.counts.total > 0 && !profile.top.length && !profile.recent.length && !profile.favorites.length) {
		profile.watched = await someWatched(id, currentProfile());
	}
	keepProfileAnswer(currentProfile(), id, profile);
	return profile;
}

export const load: PageServerLoad = async ({ params, url }) => {
	if (!onlineConnected()) error(404, "This Catalog isn't online");
	// /friends/me: your own (the My profile buttons link here, as they may not know your id yet).
	if (params.id === 'me') {
		const me = await myAccount(currentProfile());
		if (!me) error(502, "Couldn't reach the server");
		redirect(307, `/friends/${me.id}${url.search}`);
	}
	if (!/^[A-Z0-9]{16}$/.test(params.id)) error(404, 'No such person');
	// Seen before: that answer at once, and the fresh one follows into the open page (`fresh`, a
	// promise SvelteKit sends on after the page). Never seen: wait for it, as before.
	const kept = keptProfileAnswer<Profile>(currentProfile(), params.id);
	if (kept) return { profile: kept, fresh: freshProfile(params.id).catch(() => null) };
	return { profile: await freshProfile(params.id), fresh: null };
};
