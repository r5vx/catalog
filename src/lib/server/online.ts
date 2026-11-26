/**
 * Catalog online: this Catalog talking to the meeting point (the `cloud/` folder, a small server on
 * Cloudflare), for the things that need more than one house: problem reports that send themselves,
 * friends and what they're watching, watching together, one person's progress in step on two
 * computers, work shared between houses, and a TV finding its computer by a short code.
 *
 * What's sent is only ever names, titles, progress and small notes. Never the TMDB key, the Febbox
 * sign-in or anything else from the `settings` table, and never video.
 *
 * This computer is a "house" there: it registers once with the join code (Settings → Online) and
 * keeps the key it's given in `settings` (which is never exported). Each profile of the house is
 * its own person there (an "account"); a person on two computers joins them with a code, or by
 * signing in with Google.
 */
import { hostname, networkInterfaces } from 'node:os';
import { db } from './db';
import { readSettings, updateSettings } from './settings';
import { listProfiles } from './db/queries';
import { WATCHED_SQL } from '$lib/constants';
import { appVersion } from './updater';

/** Where the meeting point is. (Changed only if the server is ever moved.) */
export const ONLINE_URL = 'https://catalog-meeting.catalog-meet-f5725.workers.dev';

export type OnlineAnswer<T = unknown> = { ok: boolean; status: number; data: T | null; error: string };

type Saved = { house: string; key: string } | null;

/** This computer's place at the meeting point, while it's online (null when it never joined, or is offline for now). */
function saved(): Saved {
	const { onlineHouse, onlineKey, onlineOff } = readSettings();
	return onlineHouse && onlineKey && onlineOff !== '1' ? { house: onlineHouse, key: onlineKey } : null;
}

export const onlineConnected = () => saved() !== null;
/** Joined once, whether or not it's online now: coming back needs no join code. */
export const onlineJoined = () => Boolean(readSettings().onlineHouse && readSettings().onlineKey);
const serverUrl = () => (readSettings().onlineUrl || ONLINE_URL).replace(/\/+$/, '');
const houseName = () => (readSettings().onlineName || hostname() || 'A computer').slice(0, 40);

/** One question to the meeting point, as this house and (when given) one of its profiles. */
export async function cloud<T = unknown>(
	path: string,
	options: { method?: string; body?: unknown; profile?: number; admin?: boolean | string; open?: boolean; timeout?: number } = {}
): Promise<OnlineAnswer<T>> {
	const who = saved();
	if (!who && !options.open && !options.admin) return { ok: false, status: 0, data: null, error: "This Catalog isn't online yet" };
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (who && !options.open) {
		headers.Authorization = `Bearer ${who.house}.${who.key}`;
		headers['X-Catalog-Profile'] = String(options.profile ?? 0);
		// The profile's own name here, for the person it becomes there the first time.
		const name = profileName(options.profile ?? 0);
		if (name) headers['X-Catalog-Name'] = encodeURIComponent(name);
	}
	// (A string is a key being tried before it's kept: `tryOwnerKey`.)
	if (options.admin) headers['X-Catalog-Admin'] = typeof options.admin === 'string' ? options.admin : (readSettings().onlineAdminKey ?? '');
	try {
		const response = await fetch(serverUrl() + path, {
			method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
			signal: AbortSignal.timeout(options.timeout ?? 15_000)
		});
		const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
		return { ok: response.ok, status: response.status, data: response.ok ? data : null, error: response.ok ? '' : (data?.error ?? `The server answered ${response.status}`) };
	} catch {
		return { ok: false, status: 0, data: null, error: "The server couldn't be reached" };
	}
}

/** A profile's name on this computer ('' for the owner's while it has never been named). */
function profileName(profile: number): string {
	try {
		const found = listProfiles().find((one) => one.id === profile);
		return found && !(profile === 0 && found.name === 'Me') ? found.name : '';
	} catch {
		return '';
	}
}

/**
 * Someone's picture from the meeting point (Settings → Online), as the image itself.
 * Null when they have none or the server can't be reached.
 */
/**
 * Pictures already fetched, by person, kind and version (the `?v=` the page asks with): a profile
 * opened again shows its banner at once instead of asking the server (owner, 2026-11-18: a banner
 * profile took 4 s). The newest 40 are kept.
 */
const pictures = new Map<string, { bytes: ArrayBuffer; type: string }>();

export async function cloudPicture(account: string, kind: 'avatar' | 'banner' = 'avatar', profile = 0, version = ''): Promise<{ bytes: ArrayBuffer; type: string } | null> {
	const key = version ? `${kind}|${account}|${version}|${kind === 'banner' ? profile : ''}` : '';
	const kept = key ? pictures.get(key) : undefined;
	if (kept) return kept;
	const picture = await fetchPicture(account, kind, profile);
	if (picture && key) {
		pictures.set(key, picture);
		if (pictures.size > 40) pictures.delete(pictures.keys().next().value!);
	}
	return picture;
}

async function fetchPicture(account: string, kind: 'avatar' | 'banner', profile: number): Promise<{ bytes: ArrayBuffer; type: string } | null> {
	const who = saved();
	if (!who || !/^[A-Z0-9]{16}$/.test(account)) return null;
	try {
		// (A banner is only for friends: the server asks who is looking, so the profile goes along.)
		const response = await fetch(`${serverUrl()}/v1/${kind}/${account}`, { headers: { Authorization: `Bearer ${who.house}.${who.key}`, 'X-Catalog-Profile': String(profile) }, signal: AbortSignal.timeout(15_000) });
		const type = response.headers.get('content-type') ?? '';
		if (!response.ok || !(kind === 'banner' ? /^image\/(jpeg|png|webp|gif)$/ : /^image\/(jpeg|png|webp)$/).test(type)) return null;
		return { bytes: await response.arrayBuffer(), type };
	} catch {
		return null;
	}
}

/** The computer's own name (what a person was called online when nothing else was given). */
export const computerName = () => houseName();

/**
 * This computer joins, with the join code the owner gave out, and `name` is what the profile
 * joining is called online (asked for: people were named after their PC, 2026-11-14).
 */
export async function connectOnline(joinCode: string, name = '', profile = 0): Promise<OnlineAnswer> {
	// Back from "offline for now": the same computer and the same people as before.
	if (onlineJoined()) {
		updateSettings({ onlineOff: undefined });
		startOnline();
		return { ok: true, status: 200, data: null, error: '' };
	}
	const answer = await cloud<{ house: string; key: string }>('/v1/houses', { open: true, body: { join: joinCode.trim().toUpperCase(), name: houseName() } });
	if (answer.ok && answer.data?.house && answer.data.key) {
		updateSettings({ onlineHouse: answer.data.house, onlineKey: answer.data.key });
		// The name typed in, for the profile that joined (the person is made by this, named so).
		if (name.trim()) await cloud('/v1/me', { method: 'PUT', profile, body: { name: name.trim().slice(0, 30) } });
		startOnline();
	}
	return answer;
}

/**
 * This computer goes offline for now: nothing is sent or asked until it comes back. Its place and
 * key are kept, so its profiles are the same people, with the same friends, when it does (forgetting
 * them made everyone a stranger again, 2026-11-14).
 */
export function disconnectOnline(): void {
	for (const { id } of listProfiles()) void cloud('/v1/presence', { method: 'DELETE', profile: id });
	updateSettings({ onlineOff: '1' });
}

/* ------------------------------------------------------------ the switches (Settings → Online) */

export type OnlineSwitches = { reports: boolean; share: boolean; shared: boolean; along: boolean; autoJoin: boolean; chatButton: boolean };

/**
 * On unless turned off: problem reports, sharing what's watched with friends, shared timings, and
 * friends watching along. Off unless turned on: opening what the room starts without asking.
 */
export function onlineSwitches(): OnlineSwitches {
	const s = readSettings();
	return { reports: s.onlineReports !== '0', share: s.onlineShare !== '0', shared: s.onlineShared !== '0', along: s.onlineAlong !== '0', autoJoin: s.onlineAutoJoin === '1', chatButton: s.onlineChatButton !== '0' };
}

/** A JSON list of profile numbers from a setting ([] when there's none or it can't be read). */
export function profileList(text: string | undefined): number[] {
	try {
		const list = JSON.parse(text ?? '[]');
		return Array.isArray(list) ? list.filter((n) => Number.isInteger(n)) : [];
	} catch {
		return [];
	}
}

/**
 * The profiles whose progress is kept in step with their account: every profile, unless turned off
 * (owner, 2026-11-14: "who would sync their profiles for any reason other than syncing").
 */
export function syncProfiles(): number[] {
	const off = new Set(profileList(readSettings().onlineSyncOff));
	return listProfiles()
		.map((one) => one.id)
		.filter((id) => !off.has(id));
}

export function setSyncProfile(profile: number, on: boolean): void {
	const off = new Set(profileList(readSettings().onlineSyncOff));
	if (on) off.delete(profile);
	else off.add(profile);
	updateSettings({ onlineSyncOff: off.size ? JSON.stringify([...off]) : undefined });
	if (on) void syncNow(profile);
}

/* ------------------------------------------------------------ problem reports */

/**
 * The owner's key, typed into the Friends panel's "A friend's code" box (there's no box of its own,
 * so nobody else sees there's a key to try). Kept only when the server says it's right; the server
 * counts wrong tries per address. Friend codes are 12 characters at most, the key 43.
 */
export async function tryOwnerKey(text: string): Promise<boolean> {
	const key = text.trim();
	if (key.length < 20 || key.length > 200) return false;
	const answer = await cloud('/v1/reports?before=1', { admin: key });
	if (!answer.ok) return false;
	updateSettings({ onlineAdminKey: key });
	return true;
}

const reported = new Map<string, number>();
const REPORT_AGAIN_AFTER = 10 * 60 * 1000;

/** Addresses lose everything after "?": video links carry sign-ins in them. */
function scrub(value: unknown, depth = 0): unknown {
	if (typeof value === 'string') return value.replace(/(https?:\/\/[^\s?"']+)\?[^\s"']*/g, '$1?…').slice(0, 2000);
	if (depth > 6 || value === null || typeof value !== 'object') return value;
	if (Array.isArray(value)) return value.slice(0, 200).map((v) => scrub(v, depth + 1));
	return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrub(v, depth + 1)]));
}

/**
 * A problem sent to the owner by itself: a video that stopped to load, subtitles that wouldn't
 * match. One per title and kind every ten minutes. Nothing when reports are switched off.
 */
export function reportProblem(kind: string, title: string, details: unknown): void {
	if (!onlineConnected() || !onlineSwitches().reports) return;
	const key = `${kind}|${title}`;
	const now = Date.now();
	if (now - (reported.get(key) ?? 0) < REPORT_AGAIN_AFTER) return;
	reported.set(key, now);
	if (reported.size > 500) for (const [k, at] of reported) if (now - at > REPORT_AGAIN_AFTER) reported.delete(k);
	let version = '';
	try {
		version = appVersion();
	} catch {}
	void cloud('/v1/reports', { body: { kind, title, body: scrub({ version, at: new Date().toISOString(), details }) } });
}

/* ------------------------------------------------------------ what's being watched, for friends */

const said = new Map<number, number>();
/** What the player said about the video it has open (the year, and the room it's in), by profile. */
const playingNow = new Map<number, { title: string; year: string; room: string }>();

/**
 * The player says which year's film this is and which watch-together room it's in: the saved
 * place knows neither. Friends get the year (so "Watch it too" opens the right film of two with
 * one name) and, when watching along is allowed here, the room to join.
 */
export function noteWatchingMore(profile: number, more: { title: string; year: string; room: string }): void {
	const before = playingNow.get(profile);
	playingNow.set(profile, more);
	// Something new to say (a room started, say): the next saved place says it at once.
	if (!before || before.title !== more.title || before.room !== more.room) said.delete(profile);
}

/** Called as the player saves its place: tells this profile's friends, a minute apart at most. */
/**
 * The player was left (or closed): friends stop seeing this profile as watching straight away.
 * It used to stay up to three minutes after the last saved place, and longer to look at, since the
 * Friends page didn't ask again (owner, 2026-11-15). Watching again says so with its next save.
 */
export function noteStopped(profile: number): void {
	said.delete(profile);
	playingNow.delete(profile);
	syncSoon(profile);
	if (!onlineConnected() || !onlineSwitches().share) return;
	void cloud('/v1/presence', { method: 'DELETE', profile });
}

/**
 * The video is paused, or the player is kept out of sight: friends stop seeing this profile as
 * watching (owner, 2026-11-16). Said once (a save comes every 10 s while paused); the year and
 * room are kept, so pressing play says it all again at the next save.
 */
/** Profiles whose pause already sent their places (a save comes every 10 s while paused). */
const pauseSynced = new Set<number>();

export function notePaused(profile: number): void {
	if (!pauseSynced.has(profile)) {
		pauseSynced.add(profile);
		syncSoon(profile);
	}
	if (!said.has(profile)) return;
	said.delete(profile);
	if (!onlineConnected() || !onlineSwitches().share) return;
	void cloud('/v1/presence', { method: 'DELETE', profile });
}

export function noteWatching(profile: number, what: { title: string; type: string; season: number; episode: number; poster?: string }): void {
	pauseSynced.delete(profile);
	const switches = onlineSwitches();
	// Invisible: friends see nothing playing.
	if (!onlineConnected() || !switches.share || statusOf(profile) === 'invisible') return;
	const now = Date.now();
	if (now - (said.get(profile) ?? 0) < 60_000) return;
	said.set(profile, now);
	const more = playingNow.get(profile);
	const same = more && more.title.toLowerCase() === what.title.toLowerCase();
	void cloud('/v1/presence', { method: 'PUT', profile, body: { ...what, year: same ? more.year : '', room: same && switches.along ? more.room : '' } });
}

/* ------------------------------------------------------------ the status beside My profile */

/**
 * What friends see beside a profile's name, like Discord's: online (turns to away by itself after a
 * few minutes unused), away, do not disturb, or invisible (shown as offline, and nothing playing).
 */
export type OnlineStatus = 'online' | 'away' | 'dnd' | 'invisible';
const STATUSES: OnlineStatus[] = ['online', 'away', 'dnd', 'invisible'];

/** Each profile's pick, kept on this computer ({"0":"invisible"}); online when there's none. */
function statusPicks(): Record<string, string> {
	try {
		const kept = JSON.parse(readSettings().onlineStatus ?? '{}');
		return kept && typeof kept === 'object' ? kept : {};
	} catch {
		return {};
	}
}

export function statusOf(profile: number): OnlineStatus {
	const picked = statusPicks()[String(profile)] as OnlineStatus;
	return STATUSES.includes(picked) ? picked : 'online';
}

/** When each profile last told the meeting point it's here. */
const toldHere = new Map<number, number>();

export function setStatus(profile: number, status: OnlineStatus): void {
	const picks = statusPicks();
	if (status === 'online') delete picks[String(profile)];
	else picks[String(profile)] = status;
	updateSettings({ onlineStatus: Object.keys(picks).length ? JSON.stringify(picks) : undefined });
	if (!onlineConnected()) return;
	if (status === 'invisible') said.delete(profile);
	toldHere.set(profile, Date.now());
	void cloud('/v1/status', { method: 'PUT', profile, body: { status } });
}

/**
 * Someone is using Catalog as this profile (any page or the player): friends see them online. Told
 * every two minutes at most. Not while invisible (it was said once, when picked).
 */
export function noteHere(profile: number): void {
	const now = Date.now();
	if (now - (toldHere.get(profile) ?? 0) < 2 * 60_000) return;
	toldHere.set(profile, now);
	if (!onlineConnected()) return;
	const status = statusOf(profile);
	if (status === 'invisible') return;
	void cloud('/v1/status', { method: 'PUT', profile, body: { status } });
}

/** A watched title's key there: the site and its id on it, "tmdb:movie:550" or "anilist:21". */
const SEEN_KEY = /^[a-z]+:[\w:-]+$/;
/** What each profile's list looked like when it was last sent, so an unchanged one isn't sent again. */
const seenSent = new Map<number, string>();

/**
 * Whether the meeting point keeps every status and the Anime category (`seenAll`, 2026-11-17).
 * An older one would count a Want to watch title as watched, so until it says so only watched
 * titles go, as film or show. Asked at most every 10 minutes.
 */
let seenAllKnown: { at: number; yes: boolean } | null = null;
export async function serverKeepsAll(): Promise<boolean> {
	if (seenAllKnown && Date.now() - seenAllKnown.at < 10 * 60_000) return seenAllKnown.yes;
	const answer = await cloud<{ seenAll?: number }>('/v1/info', { open: true, timeout: 10_000 });
	if (!answer.ok) return seenAllKnown?.yes ?? false;
	seenAllKnown = { at: Date.now(), yes: answer.data?.seenAll === 1 };
	return seenAllKnown.yes;
}

/**
 * Every profile's watched titles, for their friends' "watched this" on a title's page. The owner's
 * come from the library, anyone else's from their own list. Sent whole, and only when changed.
 */
export async function shareSeen(): Promise<void> {
	if (!onlineConnected() || !onlineSwitches().share) return;
	// Every status (friends can see Want to watch, Watching…) once the server keeps them apart.
	const keepsAll = await serverKeepsAll();
	const which = keepsAll ? '' : `AND status IN ${WATCHED_SQL}`;
	for (const { id: profile } of listProfiles()) {
		const rows = (
			profile === 0
				? db
						.prepare(
							`SELECT e.source, e.source_id AS id, e.title, e.rating, e.year, c.slug AS category, e.poster_url AS poster, e.status
							 FROM entries e LEFT JOIN categories c ON c.id = e.category_id
							 WHERE e.source != 'manual' AND e.source_id IS NOT NULL ${which.replace('status', 'e.status')} ORDER BY e.id LIMIT 6000`
						)
						.all()
				: db
						.prepare(
							`SELECT source, source_id AS id, title, NULL AS rating, year, category, poster_url AS poster, status
							 FROM profile_titles WHERE profile = ? ${which} ORDER BY id LIMIT 6000`
						)
						.all(profile)
		) as { source: string; id: string; title: string; rating: number | null; year: number | null; category: string | null; poster: string | null; status: string }[];
		// (Year, film or show, poster and status too: a friend's library and profile show them.)
		const items = rows
			.map((r) => ({
				key: `${r.source}:${r.id}`,
				title: r.title,
				rating: r.rating,
				year: r.year ? String(r.year) : '',
				type: r.category === 'movies' ? 'movie' : r.category === 'anime' && keepsAll ? 'anime' : r.category ? 'tv' : '',
				poster: ACTIVITY_POSTER.test(r.poster ?? '') ? r.poster : '',
				status: r.status
			}))
			.filter((i) => SEEN_KEY.test(i.key) && i.key.length <= 40);
		const now = JSON.stringify(items);
		// (A profile with nothing watched that never sent anything has nothing to take back either.)
		if (seenSent.get(profile) === now || (!items.length && !seenSent.has(profile) && profile !== 0)) continue;
		let ok = true;
		// (The server writes only what changed. `all`, with the first part, tells it which titles left
		// the list, which it can't tell by itself when the list comes in more than one part.)
		const all = items.length > 300 ? items.map((i) => i.key) : undefined;
		for (let at = 0; (at < items.length || at === 0) && ok; at += 300) {
			const body = { reset: at === 0, add: items.slice(at, at + 300), ...(at === 0 && all ? { all } : {}) };
			ok = (await cloud('/v1/seen', { method: 'PUT', profile, body, timeout: 30_000 })).ok;
		}
		if (ok) seenSent.set(profile, now);
	}
}

/* ------------------------------------------------------------ what's been watched lately, for friends' feed */

const activitySent = new Map<number, string>();
const ACTIVITY_POSTER = /^https:\/\/(image\.tmdb\.org|s4\.anilist\.co)\//;

/**
 * Each profile's 20 titles watched most lately, with the rating given, for the feed on friends'
 * Friends page. When: the day it was finished, at the time it was marked when that's the same day
 * (an import of 400 old titles keeps their old dates, so it doesn't fill the feed). Sent when the
 * list changed, with sharing on.
 */
export async function shareActivity(): Promise<void> {
	if (!onlineConnected() || !onlineSwitches().share) return;
	for (const { id: profile } of listProfiles()) {
		// `watched`: when it was finished (entries.watched_at; profiles' titles: their last change, they have no ratings).
		type Row = { source: string; id: string; title: string; year: number | null; category: string | null; poster: string | null; rating: number | null; finished: string | null; watched: string | null };
		const rows = (
			profile === 0
				? db
						.prepare(
							`SELECT e.source, e.source_id AS id, e.title, e.year, c.slug AS category, e.poster_url AS poster, e.rating, e.finished_on AS finished, e.watched_at AS watched
							 FROM entries e LEFT JOIN categories c ON c.id = e.category_id
							 WHERE e.source IN ('tmdb', 'anilist') AND e.source_id IS NOT NULL AND e.status IN ${WATCHED_SQL}
							   AND (e.watched_at IS NOT NULL OR e.finished_on IS NOT NULL)
							 ORDER BY COALESCE(e.watched_at, e.finished_on || 'T12:00:00Z') DESC LIMIT 20`
						)
						.all()
				: db
						.prepare(
							`SELECT source, source_id AS id, title, year, category, poster_url AS poster, NULL AS rating, NULL AS finished, updated_at AS watched
							 FROM profile_titles WHERE profile = ? AND source IN ('tmdb', 'anilist') AND status IN ${WATCHED_SQL}
							 ORDER BY updated_at DESC LIMIT 20`
						)
						.all(profile)
		) as Row[];
		type Item = { key: string; title: string; year: number | string; type: string; poster: string; rating: number | null; at: number; season?: number; episode?: number };
		const toItem = (r: Row): Item => {
			const marked = r.watched ? Date.parse(/[zZ]$/.test(r.watched) ? r.watched : `${r.watched.replace(' ', 'T')}Z`) || 0 : 0;
			const day = r.finished && /^\d{4}-\d{2}-\d{2}$/.test(r.finished) ? r.finished : '';
			// A rating changed later never moves it: no stamp (finished before the stamp existed) means its finished day.
			const at = day && (!marked || new Date(marked).toISOString().slice(0, 10) !== day) ? Date.parse(`${day}T12:00:00Z`) : marked;
			return {
				key: `${r.source}:${r.id}`,
				title: r.title,
				year: r.year ?? '',
				type: r.category === 'movies' ? 'movie' : 'tv',
				poster: ACTIVITY_POSTER.test(r.poster ?? '') ? (r.poster ?? '') : '',
				rating: r.rating,
				at
			};
		};
		const byTitle = new Map(rows.map(toItem).map((item) => [item.title.toLowerCase(), item]));
		// Shows and anime: the episode watched last, and when (owner, 2026-11-15: "it should show the
		// episode they watched instead of just showing the entire anime"). An episode counts once
		// most of it is watched; a show still being watched comes in this way too.
		const episodes = db
			.prepare(
				`SELECT title, season, episode, updated_at AS updated FROM watch_progress
				 WHERE profile = ? AND type = 'tv' AND episode > 0 AND duration > 0 AND CAST("current_time" AS REAL) >= duration * 0.8
				 ORDER BY updated_at DESC LIMIT 300`
			)
			.all(profile) as { title: string; season: number; episode: number; updated: string }[];
		const showOf =
			profile === 0
				? db.prepare(
						`SELECT e.source, e.source_id AS id, e.title, e.year, c.slug AS category, e.poster_url AS poster, e.rating, NULL AS finished, NULL AS watched
						 FROM entries e LEFT JOIN categories c ON c.id = e.category_id
						 WHERE lower(e.title) = lower(?) AND e.source IN ('tmdb', 'anilist') AND e.source_id IS NOT NULL AND COALESCE(c.slug, '') != 'movies' LIMIT 1`
					)
				: db.prepare(
						`SELECT source, source_id AS id, title, year, category, poster_url AS poster, NULL AS rating, NULL AS finished, NULL AS watched
						 FROM profile_titles WHERE profile = ? AND lower(title) = lower(?) AND source IN ('tmdb', 'anilist') AND category != 'movies' LIMIT 1`
					);
		const done = new Set<string>();
		for (const ep of episodes) {
			const name = ep.title.toLowerCase();
			if (done.has(name)) continue;
			done.add(name);
			if (done.size > 20) break;
			const at = Date.parse(`${ep.updated.replace(' ', 'T')}Z`) || 0;
			let item = byTitle.get(name);
			if (!item) {
				const show = (profile === 0 ? showOf.get(ep.title) : showOf.get(profile, ep.title)) as Row | undefined;
				if (!show) continue;
				item = toItem(show);
				byTitle.set(name, item);
			}
			item.season = ep.season;
			item.episode = ep.episode;
			if (at > item.at) item.at = at;
		}
		const items = [...byTitle.values()]
			.filter((i) => SEEN_KEY.test(i.key) && i.key.length <= 40 && i.at > 0)
			.sort((a, b) => b.at - a.at)
			.slice(0, 20);
		const now = JSON.stringify(items);
		if (activitySent.get(profile) === now || (!items.length && !activitySent.has(profile) && profile !== 0)) continue;
		const answer = await cloud('/v1/activity', { method: 'PUT', profile, body: { items }, timeout: 20_000 });
		if (answer.ok) activitySent.set(profile, now);
	}
}

/**
 * The last answers about friends, per profile, so the Friends page shows them the moment it
 * opens (it was blank for a second while the meeting point was asked), then asks again.
 */
const friendsKept = new Map<number, { friends?: unknown; activity?: unknown; friendsAt?: number }>();
export function keepFriendsAnswer(profile: number, what: 'friends' | 'activity', data: unknown): void {
	friendsKept.set(profile, { ...friendsKept.get(profile), [what]: data, ...(what === 'friends' ? { friendsAt: Date.now() } : {}) });
}
/**
 * "Watching now" is only shown from a kept answer of the last 2 minutes: an older one showed a
 * friend watching what they'd watched 12 hours before, for a moment (owner, 2026-11-18). Names
 * and pictures still show at once; the fresh answer brings who's watching.
 */
const WATCHING_KEPT_FOR = 2 * 60_000;
export function friendsSnapshot(profile: number): { friends: unknown; activity: unknown } {
	const kept = friendsKept.get(profile);
	let friends = kept?.friends ?? null;
	const answer = friends as { friends?: { watching?: unknown }[] } | null;
	if (answer && Array.isArray(answer.friends) && Date.now() - (kept?.friendsAt ?? 0) > WATCHING_KEPT_FOR) {
		friends = { ...answer, friends: answer.friends.map((friend) => ({ ...friend, watching: null })) };
	}
	return { friends, activity: kept?.activity ?? null };
}

/** When each profile's friends were last asked for, just for their number. */
const friendCountAsked = new Map<number, number>();
/**
 * How many friends a profile has online, for the Friends tab's number (owner, 2026-11-25): from the
 * last answer kept, asked for in the background when there's none or it's over 10 minutes old.
 * Null until it's known.
 */
export function friendCountOf(profile: number): number | null {
	const kept = friendsKept.get(profile);
	const now = Date.now();
	const stale = now - (kept?.friendsAt ?? 0) > 10 * 60_000;
	if (stale && onlineConnected() && now - (friendCountAsked.get(profile) ?? 0) > 10 * 60_000) {
		friendCountAsked.set(profile, now);
		void cloud('/v1/friends', { profile }).then((answer) => {
			if (answer.ok && answer.data) keepFriendsAnswer(profile, 'friends', answer.data);
		});
	}
	const list = (kept?.friends as { friends?: unknown[] } | undefined)?.friends;
	return Array.isArray(list) ? list.length : null;
}

/**
 * Each profile page's last answer (src/routes/friends/[id]/+page.server.ts), so it opens at once
 * and the fresh one follows: opening My profile waited ~0.2 s on the meeting point every time and
 * showed the loading bar (owner, 2026-11-19). Forgotten whenever this profile changes something
 * there (the page's own saves), so an edit never shows the old one first.
 */
const profilesKept = new Map<string, { profile: unknown; at: number }>();
const PROFILE_KEPT_FOR = 60 * 60_000;
export function keepProfileAnswer(profile: number, id: string, answer: unknown): void {
	profilesKept.set(`${profile}|${id}`, { profile: answer, at: Date.now() });
	if (profilesKept.size > 40) profilesKept.delete(profilesKept.keys().next().value!);
}
export function keptProfileAnswer<T extends { watching?: unknown }>(profile: number, id: string): T | null {
	const kept = profilesKept.get(`${profile}|${id}`);
	if (!kept || Date.now() - kept.at > PROFILE_KEPT_FOR) return null;
	const answer = kept.profile as T;
	// (The same 2 minutes as the Friends page: an old "watching" isn't shown.)
	return Date.now() - kept.at > WATCHING_KEPT_FOR ? { ...answer, watching: null } : answer;
}
export function forgetProfileAnswers(profile: number): void {
	for (const key of [...profilesKept.keys()]) if (key.startsWith(`${profile}|`)) profilesKept.delete(key);
}

/**
 * Who each profile is online (id, name, picture), remembered from any answer that said so, for the
 * My profile button in the library's top bar and the sidebar (src/lib/MyProfileButton.svelte).
 */
export type Me = { id: string; name: string; avatar: number };
const meKept = new Map<number, Me>();
export function keepMe(profile: number, account: unknown): void {
	const a = account as Partial<Me> | null;
	if (a && typeof a.id === 'string' && /^[A-Z0-9]{16}$/.test(a.id)) meKept.set(profile, { id: a.id, name: String(a.name ?? ''), avatar: Number(a.avatar ?? 0) || 0 });
}
export const keptMe = (profile: number): Me | null => (onlineConnected() ? (meKept.get(profile) ?? null) : null);

/** Who this profile is online, asking the meeting point when it isn't known yet. */
export async function myAccount(profile: number): Promise<Me | null> {
	const kept = keptMe(profile);
	if (kept || !onlineConnected()) return kept;
	const hello = await cloud<{ account: Me }>('/v1/hello', { profile, body: {} });
	keepMe(profile, hello.data?.account);
	return keptMe(profile);
}

/** Pages ask for it in the background (at most once a minute a profile, so a server that's down isn't asked on every page). */
const meAsked = new Map<number, number>();
export function warmMe(profile: number): void {
	if (keptMe(profile) || !onlineConnected() || Date.now() - (meAsked.get(profile) ?? 0) < 60_000) return;
	meAsked.set(profile, Date.now());
	void myAccount(profile).catch(() => {});
}

/* ------------------------------------------------------------ progress in step between computers */

type SyncState = Record<string, { pushed: string; rev: number }>;

function syncState(): SyncState {
	try {
		return JSON.parse(readSettings().onlineSyncState ?? '{}') as SyncState;
	} catch {
		return {};
	}
}

type ProgressRow = { title: string; type: string; season: number; episode: number; place: number; duration: number; poster: string; updated: string };
const syncing = new Set<number>();
/** When each profile's last sync finished, and what it did (Settings → Online shows it). */
export const lastSync = new Map<number, { at: number; sent: number; got: number; error: string }>();

/**
 * One profile's watch progress, both ways. Sent: every place saved here since the last time.
 * Taken: every place saved on the person's other computers since, where it's newer than the one
 * here. Nothing is ever deleted by this, here or there.
 */
export async function syncNow(profile: number): Promise<{ sent: number; got: number; error: string }> {
	if (!onlineConnected() || !syncProfiles().includes(profile)) return { sent: 0, got: 0, error: 'Sync is off' };
	if (syncing.has(profile)) return { sent: 0, got: 0, error: '' };
	syncing.add(profile);
	const done = (sent: number, got: number, error: string) => {
		lastSync.set(profile, { at: Date.now(), sent, got, error });
		return { sent, got, error };
	};
	try {
		const state = syncState()[String(profile)] ?? { pushed: '', rev: 0 };
		// Out: what changed here since last time (oldest first, so a part that fails is asked again).
		const changed = db
			.prepare(
				`SELECT title, type, season, episode, CAST("current_time" AS REAL) AS place, duration, poster_url AS poster, updated_at AS updated
				 FROM watch_progress WHERE profile = ? AND updated_at > ? ORDER BY updated_at LIMIT 2000`
			)
			.all(profile, state.pushed) as ProgressRow[];
		let sent = 0;
		let pushed = state.pushed;
		for (let at = 0; at < changed.length; at += 300) {
			const part = changed.slice(at, at + 300);
			const answer = await cloud('/v1/sync', {
				method: 'PUT',
				profile,
				timeout: 30_000,
				body: {
					rows: part.map((r) => ({
						kind: 'progress',
						key: `${r.title}|${r.type}|${r.season}|${r.episode}`,
						value: { t: r.place, d: r.duration, p: r.poster ?? '' },
						updated: Date.parse(`${r.updated.replace(' ', 'T')}Z`)
					}))
				}
			});
			if (!answer.ok) return done(sent, 0, answer.error);
			sent += part.length;
			pushed = part[part.length - 1].updated;
		}
		// In: what changed on the person's other computers.
		let rev = state.rev;
		let got = 0;
		const take = db.prepare(
			`INSERT INTO watch_progress (profile, title, type, season, episode, "current_time", duration, sub_url, sub_delay, sub_file_name, poster_url, share_key, fid, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, '', 0, '', ?, '', 0, ?)
			 ON CONFLICT (profile, title, type, season, episode) DO UPDATE SET
				"current_time" = excluded."current_time",
				duration = excluded.duration,
				poster_url = CASE WHEN excluded.poster_url != '' THEN excluded.poster_url ELSE watch_progress.poster_url END,
				updated_at = excluded.updated_at
			 WHERE excluded.updated_at > watch_progress.updated_at`
		);
		// A show's episode: the place here, to keep the farther of the two.
		const mine = db.prepare(
			`SELECT CAST("current_time" AS REAL) AS place, duration, poster_url AS poster, updated_at AS updated
			 FROM watch_progress WHERE profile = ? AND title = ? AND type = 'tv' AND season = ? AND episode = ?`
		);
		const takeFarther = db.prepare(
			`UPDATE watch_progress SET "current_time" = ?, duration = ?, updated_at = MAX(updated_at, ?),
				poster_url = CASE WHEN ? != '' THEN ? ELSE poster_url END
			 WHERE profile = ? AND title = ? AND type = 'tv' AND season = ? AND episode = ?`
		);
		const stamp = db.prepare(`UPDATE watch_progress SET updated_at = ? WHERE profile = ? AND title = ? AND type = 'tv' AND season = ? AND episode = ?`);
		/** Episodes where this computer had got farther: sent back out at once, so the others get the farther place too. */
		const sendBack: { kind: string; key: string; value: { t: number; d: number; p: string }; updated: number }[] = [];
		const asTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
		for (let round = 0; round < 20; round++) {
			type Row = { kind: string; key: string; value: { t?: number; d?: number; p?: string }; updated: number };
			const answer = await cloud<{ rows: Row[]; rev: number; more: boolean }>(`/v1/sync?since=${rev}`, { profile, timeout: 30_000 });
			if (!answer.ok || !answer.data) return done(sent, got, answer.error);
			for (const row of answer.data.rows) {
				if (row.kind !== 'progress') continue;
				const [title, type, season, episode] = row.key.split('|');
				const place = Number(row.value?.t);
				const duration = Number(row.value?.d);
				if (!title || !Number.isFinite(place) || !Number.isFinite(duration)) continue;
				const when = asTime(row.updated);
				const poster = /^https:\/\/image\.tmdb\.org\//.test(row.value?.p ?? '') ? row.value.p! : '';
				const s = Number(season) || 0;
				const e = Number(episode) || 0;
				// A show (owner, 2026-11-14: "for tv shows make it accept the one that has farther
				// progress"): half an episode watched here and half there ends at the farther place on
				// both, whichever was saved last. Films: the one saved last, as before.
				const here = type === 'tv' ? (mine.get(profile, title, s, e) as { place: number; duration: number; poster: string; updated: string } | undefined) : undefined;
				if (here) {
					if (place > here.place) {
						takeFarther.run(place, duration, when, poster, poster, profile, title, s, e);
						got++;
					} else if (here.place > place) {
						// Saved after the farther one there: this one goes back out, a second later than theirs.
						const theirs = row.updated + 1000;
						if (Date.parse(`${here.updated.replace(' ', 'T')}Z`) < theirs) stamp.run(asTime(theirs), profile, title, s, e);
						sendBack.push({ kind: 'progress', key: row.key, value: { t: here.place, d: here.duration, p: here.poster ?? '' }, updated: Math.max(theirs, Date.parse(`${here.updated.replace(' ', 'T')}Z`) || 0) });
					}
					continue;
				}
				const result = take.run(profile, title, type === 'tv' ? 'tv' : 'movie', s, e, place, duration, poster, when);
				if (result.changes) got++;
			}
			rev = answer.data.rev;
			if (!answer.data.more) break;
		}
		for (let at = 0; at < sendBack.length; at += 300) {
			const answer = await cloud('/v1/sync', { method: 'PUT', profile, timeout: 30_000, body: { rows: sendBack.slice(at, at + 300) } });
			if (!answer.ok) break;
			sent += Math.min(300, sendBack.length - at);
		}
		// (What was just taken is as old as it was there, so it isn't sent back as news.)
		const all = syncState();
		all[String(profile)] = { pushed, rev };
		updateSettings({ onlineSyncState: JSON.stringify(all) });
		return done(sent, got, '');
	} catch (error) {
		return done(0, 0, String(error));
	} finally {
		syncing.delete(profile);
	}
}

/**
 * The player stopped or paused: this profile's places go out in a few seconds, not at the next
 * two-minute round (friend, 2026-11-18: watched Teacup to E6 on the PC, the MacBook was back at E3:
 * a computer shut or put to sleep soon after watching never sent the last episodes).
 */
const syncTimers = new Map<number, ReturnType<typeof setTimeout>>();
export function syncSoon(profile: number, after = 5000): void {
	if (!onlineConnected() || !syncProfiles().includes(profile)) return;
	clearTimeout(syncTimers.get(profile));
	const timer = setTimeout(() => {
		syncTimers.delete(profile);
		void syncNow(profile);
	}, after);
	timer.unref?.();
	syncTimers.set(profile, timer);
}

/**
 * Before the player picks where a show was left: the other computers' places brought in first
 * (at most 4 s waited), unless a sync finished in the last minute. A computer just opened or woken
 * showed the episode it knew of before.
 */
export async function freshenProgress(profile: number): Promise<void> {
	if (!onlineConnected() || !syncProfiles().includes(profile)) return;
	if (Date.now() - (lastSync.get(profile)?.at ?? 0) < 60_000) return;
	await Promise.race([syncNow(profile).catch(() => {}), new Promise((done) => setTimeout(done, 4000))]);
}

/* ------------------------------------------------------------ work shared between houses */

/** Something another house worked out (intro and credit times, say), or null. */
export async function sharedGet<T>(kind: 'skips' | 'subtiming' | 'sharpness', key: string): Promise<T | null> {
	if (!onlineConnected() || !onlineSwitches().shared) return null;
	const answer = await cloud<{ value: T | null }>(`/v1/shared/${kind}?key=${encodeURIComponent(key)}`, { timeout: 6000 });
	return answer.data?.value ?? null;
}

/** Something this house worked out, for the others. */
export function sharedPut(kind: 'skips' | 'subtiming' | 'sharpness', key: string, value: unknown): void {
	if (!onlineConnected() || !onlineSwitches().shared) return;
	void cloud(`/v1/shared/${kind}`, { method: 'PUT', body: { key, value } });
}

/* ------------------------------------------------------------ a TV finding this computer by a code */

/** This computer's addresses on the home network, as a TV would type them. */
function homeAddresses(port: string): string[] {
	const found: string[] = [];
	for (const list of Object.values(networkInterfaces())) {
		for (const one of list ?? []) if (one.family === 'IPv4' && !one.internal) found.push(one.address);
	}
	// A home router's addresses first, then the rest (virtual adapters), Tailscale's 100.x last:
	// the TV tries them in this order.
	const rank = (address: string) => (address.startsWith('192.168.') ? 0 : address.startsWith('10.') ? 1 : address.startsWith('100.') ? 3 : 2);
	return found
		.sort((a, b) => rank(a) - rank(b))
		.slice(0, 6)
		.map((address) => `http://${address}:${port}`);
}

let pairing: { code: string; until: number } | null = null;

/** A six-digit code a TV can type instead of this computer's address (good for 15 minutes; the same one until then). */
export async function pairingCode(port: string): Promise<{ code: string; minutes: number } | null> {
	if (!onlineConnected()) return null;
	if (pairing && pairing.until - Date.now() > 3 * 60_000) return { code: pairing.code, minutes: Math.round((pairing.until - Date.now()) / 60_000) };
	const answer = await cloud<{ code: string; minutes: number }>('/v1/pair', { method: 'PUT', body: { name: houseName(), addresses: homeAddresses(port) } });
	if (!answer.ok || !answer.data) return null;
	pairing = { code: answer.data.code, until: Date.now() + answer.data.minutes * 60_000 };
	return answer.data;
}

/* ------------------------------------------------------------ in the background */

/* ------------------------------------------------------------ asking less when nobody's using it */

/**
 * Syncing every 2 minutes is only worth it while someone is using this Catalog (owner, 2026-11-15:
 * "ask less often"; measured that day, the two syncs were 14% of everything the server was asked,
 * mostly from computers nobody was at). In use = any page or player request in the last 15
 * minutes (src/hooks.server.ts). Otherwise a round every 10 minutes, and one at once when someone
 * comes back, so another computer's places show up when they're wanted.
 */
const IN_USE_FOR = 15 * 60 * 1000;
const IDLE_EVERY = 10 * 60 * 1000;
let lastUse = Date.now();
const backListeners: (() => void)[] = [];

export function noteInUse(): void {
	const wasIdle = Date.now() - lastUse > IN_USE_FOR;
	lastUse = Date.now();
	if (wasIdle) for (const run of backListeners) run();
}
export const inUse = () => Date.now() - lastUse < IN_USE_FOR;

/**
 * Runs `round` every 2 minutes while in use, every 10 when not, and right away when someone comes
 * back after a quiet spell. Used by the progress sync here and the library sync (librarySync.ts).
 */
export function everyRound(round: () => void, firstAfter: number): void {
	let lastRound = 0;
	const go = () => {
		lastRound = Date.now();
		round();
	};
	setTimeout(go, firstAfter).unref?.();
	setInterval(() => {
		if (inUse() || Date.now() - lastRound >= IDLE_EVERY - 5000) go();
	}, 2 * 60 * 1000).unref?.();
	backListeners.push(() => {
		if (Date.now() - lastRound > 60_000) go();
	});
}

let started = false;

/** How the library looked at the last look (its newest change and size), and whether a send is under way. */
let libraryMark = '';
let sharingNow = false;

/** Shares what's watched (and the feed) when the library changed since the last look: a quick local check. */
async function shareIfLibraryChanged(): Promise<void> {
	if (sharingNow || !onlineConnected() || !onlineSwitches().share) return;
	try {
		const entries = db.prepare('SELECT max(updated_at) AS at, count(*) AS n FROM entries').get() as { at: string | null; n: number };
		const others = db.prepare('SELECT max(id) AS id, count(*) AS n FROM profile_titles').get() as { id: number | null; n: number };
		const mark = `${entries.at}|${entries.n}|${others.id}|${others.n}`;
		if (mark === libraryMark) return;
		const first = !libraryMark;
		libraryMark = mark;
		// (The first look only notes where things stand: startOnline sends soon after starting anyway.)
		if (first) return;
		sharingNow = true;
		await shareSeen();
		await shareActivity();
	} catch {
	} finally {
		sharingNow = false;
	}
}

/** Says hello, shares what each profile has watched (looked at every 10 minutes, sent when it changed), and keeps the synced profiles in step every two minutes. */
export function startOnline(): void {
	if (started || !onlineConnected()) return;
	started = true;
	const hello = () => void cloud<{ account: Me }>('/v1/hello', { profile: 0, body: { house: houseName() } }).then((answer) => keepMe(0, answer.data?.account));
	setTimeout(hello, 20_000).unref?.();
	setTimeout(() => void shareSeen().catch(() => {}), 90_000).unref?.();
	setInterval(() => void shareSeen().catch(() => {}), 10 * 60 * 1000).unref?.();
	// Lately watched, for friends' feed: soon after start, then every 5 minutes (sent only when changed).
	setTimeout(() => void shareActivity().catch(() => {}), 60_000).unref?.();
	setInterval(() => void shareActivity().catch(() => {}), 5 * 60 * 1000).unref?.();
	// A rating or status changed: sent within about 20 s, not at the next 10-minute look (owner,
	// 2026-11-16: "changed a rating... it took forever" on the profile).
	setInterval(() => void shareIfLibraryChanged(), 20_000).unref?.();
	// Progress in step: every 2 minutes while in use, every 10 when not (everyRound above).
	everyRound(() => {
		for (const profile of syncProfiles()) void syncNow(profile);
	}, 3_000);
	// Libraries kept in step, by their own switch (librarySync.ts).
	void import('./librarySync').then((m) => m.startLibrarySync()).catch(() => {});
}
