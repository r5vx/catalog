import { error, json } from '@sveltejs/kit';
import { cloud, keepMe, myAccount, computerName, connectOnline, disconnectOnline, noteStopped, lastSync, noteWatchingMore, onlineConnected, onlineJoined, onlineSwitches, setStatus, setSyncProfile, syncNow, syncProfiles, tryOwnerKey } from '$lib/server/online';
import { forgetOwner, isOwner, rememberOwner } from '$lib/server/ownerSession';
import { updateSettings } from '$lib/server/settings';
import { currentProfile } from '$lib/server/profile';
import { lastLibrarySync, libraryPreview, libraryProfiles, nameOnlyCount, removalsOn, setLibraryProfile, syncLibrary } from '$lib/server/librarySync';
import type { RequestHandler } from './$types';

/**
 * Catalog online (src/lib/server/online.ts), for Settings → Online: whether this computer has
 * joined, who the profile asking is there, and the switches.
 */
type Account = { id: string; name: string; google: boolean; email: string | null; avatar: number };

export const GET: RequestHandler = async ({ url, cookies }) => {
	const profile = currentProfile();
	const connected = onlineConnected();
	// ?light=1: only what this computer knows by itself (the player asks this; nothing goes to the server).
	if (url.searchParams.get('light') === '1') return json({ connected, switches: onlineSwitches() });
	// ?me=1: who this profile is (id, name, picture), for the My profile button when the page didn't know yet.
	if (url.searchParams.get('me') === '1') return json({ me: connected ? await myAccount(profile).catch(() => null) : null });
	let account: Account | null = null;
	let computers = 0;
	let google = false;
	let problem = '';
	if (connected) {
		const hello = await cloud<{ account: Account; computers: number; google: boolean }>('/v1/hello', { profile, body: {} });
		account = hello.data?.account ?? null;
		keepMe(profile, account);
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
		removals: removalsOn(),
		/** The computer's name: a person still called that hasn't picked a name (the page asks for one). */
		computerName: computerName(),
		owner: isOwner(cookies)
	});
};

/**
 * Body { action, … }:
 *   connect { join, name } this computer joins, with the join code and the name friends will see
 *   disconnect             and leaves
 *   switches { reports, share, shared, along, autoJoin? }
 *   watching { title, year, room }   the player: which year's film is open, and its watch-together room
 *   stopped                the player was left or closed: friends stop seeing this profile as watching
 *   status { status }      the status beside My profile: online, away, dnd or invisible
 *   sync { on }            this profile's progress kept in step (or not); syncNow does a round at once
 *   removals { on }        titles removed on the person's other computers removed here too (or not; per computer)
 *   libraryPreview         what keeping this profile's library in step would do (changes nothing)
 *   library { on }         this profile's library kept in step (or not); on does the first round. libraryNow: a round at once
 *   owner { key }          the owner's key, to read problem reports here, kept when right ('' forgets it)
 */
export const POST: RequestHandler = async ({ request, cookies, url }) => {
	const body = await request.json().catch(() => ({}));
	const profile = currentProfile();
	if (body.action === 'connect') {
		// A first join needs the name friends will see (coming back from "offline for now" doesn't).
		const name = String(body.name ?? '').trim();
		if (!onlineJoined() && !name) return error(400, 'Type the name your friends will see');
		const answer = await connectOnline(String(body.join ?? ''), name, profile);
		if (!answer.ok) return error(answer.status === 403 ? 403 : 502, answer.error);
		return json({ ok: true });
	}
	if (body.action === 'disconnect') {
		disconnectOnline();
		return json({ ok: true });
	}
	if (body.action === 'switches') {
		const flag = (value: unknown) => (value === false ? '0' : undefined);
		updateSettings({
			onlineReports: flag(body.reports),
			onlineShare: flag(body.share),
			onlineShared: flag(body.shared),
			onlineAlong: flag(body.along),
			// (Sent alone by the "Join?" box; left as it is when a page sends only the others.)
			...('autoJoin' in body ? { onlineAutoJoin: body.autoJoin === true ? '1' : undefined } : {}),
			...('chatButton' in body ? { onlineChatButton: body.chatButton === false ? '0' : undefined } : {})
		});
		if (body.share === false) void cloud('/v1/presence', { method: 'DELETE', profile });
		return json({ ok: true });
	}
	if (body.action === 'status') {
		const status = ['online', 'away', 'dnd', 'invisible'].includes(body.status) ? body.status : 'online';
		setStatus(profile, status);
		return json({ ok: true, status });
	}
	if (body.action === 'stopped') {
		noteStopped(profile);
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
	if (body.action === 'removals') {
		updateSettings({ onlineRemovals: body.on === false ? '0' : undefined });
		return json({ ok: true });
	}
	if (body.action === 'owner') {
		const key = String(body.key ?? '').trim();
		if (!key) {
			forgetOwner(cookies);
			return json({ ok: true });
		}
		// Kept only when the server says it's the owner's key (wrong tries are counted there).
		const ok = await tryOwnerKey(key);
		if (ok) rememberOwner(cookies, url.protocol === 'https:');
		return json({ ok });
	}
	return error(400, 'Unknown action');
};
