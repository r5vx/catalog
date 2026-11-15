import { error, json } from '@sveltejs/kit';
import { cloud, connectOnline, disconnectOnline, lastSync, noteWatchingMore, onlineConnected, onlineJoined, onlineSwitches, setSyncProfile, syncNow, syncProfiles, tryOwnerKey } from '$lib/server/online';
import { readSettings, updateSettings } from '$lib/server/settings';
import { currentProfile } from '$lib/server/profile';
import { lastLibrarySync, libraryPreview, libraryProfiles, nameOnlyCount, setLibraryProfile, syncLibrary } from '$lib/server/librarySync';
import type { RequestHandler } from './$types';

/**
 * Catalog online (src/lib/server/online.ts), for Settings → Online: whether this computer has
 * joined, who the profile asking is there, and the switches.
 */
type Account = { id: string; name: string; google: boolean; email: string | null; avatar: number };

export const GET: RequestHandler = async ({ url }) => {
	const profile = currentProfile();
	const connected = onlineConnected();
	// ?light=1: only what this computer knows by itself (the player asks this; nothing goes to the server).
	if (url.searchParams.get('light') === '1') return json({ connected, switches: onlineSwitches() });
	let account: Account | null = null;
	let computers = 0;
	let google = false;
	let problem = '';
	if (connected) {
		const hello = await cloud<{ account: Account; computers: number; google: boolean }>('/v1/hello', { profile, body: {} });
		account = hello.data?.account ?? null;
		computers = hello.data?.computers ?? 0;
		google = hello.data?.google ?? false;
		problem = hello.ok ? '' : hello.error;
	}
	return json({
		connected,
		/** Joined before and offline for now: it can come back without the join code. */
		joined: onlineJoined(),
		problem,
		account,
		computers,
		google,
		switches: onlineSwitches(),
		sync: syncProfiles().includes(profile),
		lastSync: lastSync.get(profile) ?? null,
		library: { on: libraryProfiles().includes(profile), last: lastLibrarySync.get(profile) ?? null, nameOnly: nameOnlyCount(profile) },
		owner: Boolean(readSettings().onlineAdminKey)
	});
};

/**
 * Body { action, … }:
 *   connect { join }       this computer joins, with the join code
 *   disconnect             and leaves
 *   switches { reports, share, shared, along }
 *   watching { title, year, room }   the player: which year's film is open, and its watch-together room
 *   sync { on }            this profile's progress kept in step (or not); syncNow does a round at once
 *   libraryPreview         what keeping this profile's library in step would do (changes nothing)
 *   library { on }         this profile's library kept in step (or not); on does the first round. libraryNow: a round at once
 *   owner { key }          the owner's key, to read problem reports here, kept when right ('' forgets it)
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const profile = currentProfile();
	if (body.action === 'connect') {
		const answer = await connectOnline(String(body.join ?? ''));
		if (!answer.ok) return error(answer.status === 403 ? 403 : 502, answer.error);
		return json({ ok: true });
	}
	if (body.action === 'disconnect') {
		disconnectOnline();
		return json({ ok: true });
	}
	if (body.action === 'switches') {
		const flag = (value: unknown) => (value === false ? '0' : undefined);
		updateSettings({ onlineReports: flag(body.reports), onlineShare: flag(body.share), onlineShared: flag(body.shared), onlineAlong: body.along === true ? '1' : undefined });
		if (body.share === false) void cloud('/v1/presence', { method: 'DELETE', profile });
		return json({ ok: true });
	}
	if (body.action === 'watching') {
		const room = String(body.room ?? '');
		noteWatchingMore(profile, { title: String(body.title ?? '').slice(0, 120), year: String(body.year ?? '').slice(0, 4), room: /^[A-Z0-9]{6}$/.test(room) ? room : '' });
		return json({ ok: true });
	}
	if (body.action === 'sync') {
		setSyncProfile(profile, body.on === true);
		return json({ ok: true });
	}
	if (body.action === 'syncNow') return json(await syncNow(profile));
	if (body.action === 'libraryPreview') return json(await libraryPreview(profile));
	if (body.action === 'library') return json({ ok: true, round: await setLibraryProfile(profile, body.on === true) });
	if (body.action === 'libraryNow') return json(await syncLibrary(profile));
	if (body.action === 'owner') {
		const key = String(body.key ?? '').trim();
		if (!key) {
			updateSettings({ onlineAdminKey: undefined });
			return json({ ok: true });
		}
		// Kept only when the server says it's the owner's key (wrong tries are counted there).
		return json({ ok: await tryOwnerKey(key) });
	}
	return error(400, 'Unknown action');
};
