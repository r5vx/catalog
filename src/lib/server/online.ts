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
	options: { method?: string; body?: unknown; profile?: number; admin?: boolean; open?: boolean; timeout?: number } = {}
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
	if (options.admin) headers['X-Catalog-Admin'] = readSettings().onlineAdminKey ?? '';
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
 * Someone's picture from the meeting point (Settings → Profile), as the image itself.
 * Null when they have none or the server can't be reached.
 */
export async function cloudPicture(account: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
	const who = saved();
	if (!who || !/^[A-Z0-9]{16}$/.test(account)) return null;
	try {
		const response = await fetch(`${serverUrl()}/v1/avatar/${account}`, { headers: { Authorization: `Bearer ${who.house}.${who.key}` }, signal: AbortSignal.timeout(10_000) });
		const type = response.headers.get('content-type') ?? '';
		if (!response.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return null;
		return { bytes: await response.arrayBuffer(), type };
	} catch {
		return null;
	}
}

/** This computer joins, with the join code the owner gave out. */
export async function connectOnline(joinCode: string): Promise<OnlineAnswer> {
	// Back from "offline for now": the same computer and the same people as before.
	if (onlineJoined()) {
		updateSettings({ onlineOff: undefined });
		startOnline();
		return { ok: true, status: 200, data: null, error: '' };
	}
	const answer = await cloud<{ house: string; key: string }>('/v1/houses', { open: true, body: { join: joinCode.trim().toUpperCase(), name: houseName() } });
	if (answer.ok && answer.data?.house && answer.data.key) {
		updateSettings({ onlineHouse: answer.data.house, onlineKey: answer.data.key });
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

export type OnlineSwitches = { reports: boolean; share: boolean; shared: boolean; along: boolean };

/** On unless turned off: problem reports, sharing what's watched with friends, shared timings. Watching along is off unless turned on. */
export function onlineSwitches(): OnlineSwitches {
	const s = readSettings();
	return { reports: s.onlineReports !== '0', share: s.onlineShare !== '0', shared: s.onlineShared !== '0', along: s.onlineAlong === '1' };
}

/** The profiles whose progress is kept in step with their account. */
export function syncProfiles(): number[] {
	try {
		const list = JSON.parse(readSettings().onlineSync ?? '[]');
		return Array.isArray(list) ? list.filter((n) => Number.isInteger(n)) : [];
	} catch {
		return [];
	}
}

export function setSyncProfile(profile: number, on: boolean): void {
	const now = new Set(syncProfiles());
	if (on) now.add(profile);
	else now.delete(profile);
	updateSettings({ onlineSync: now.size ? JSON.stringify([...now]) : undefined });
	if (on) void syncNow(profile);
}

/* ------------------------------------------------------------ problem reports */

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
export function noteWatching(profile: number, what: { title: string; type: string; season: number; episode: number; poster?: string }): void {
	const switches = onlineSwitches();
	if (!onlineConnected() || !switches.share) return;
	const now = Date.now();
	if (now - (said.get(profile) ?? 0) < 60_000) return;
	said.set(profile, now);
	const more = playingNow.get(profile);
	const same = more && more.title.toLowerCase() === what.title.toLowerCase();
	void cloud('/v1/presence', { method: 'PUT', profile, body: { ...what, year: same ? more.year : '', room: same && switches.along ? more.room : '' } });
}

/** A watched title's key there: the site and its id on it, "tmdb:movie:550" or "anilist:21". */
const SEEN_KEY = /^[a-z]+:[\w:-]+$/;
/** What each profile's list looked like when it was last sent, so an unchanged one isn't sent again. */
const seenSent = new Map<number, string>();

/**
 * Every profile's watched titles, for their friends' "watched this" on a title's page. The owner's
 * come from the library, anyone else's from their own list. Sent whole, and only when changed.
 */
export async function shareSeen(): Promise<void> {
	if (!onlineConnected() || !onlineSwitches().share) return;
	for (const { id: profile } of listProfiles()) {
		const rows = (
			profile === 0
				? db.prepare(`SELECT source, source_id AS id, title, rating FROM entries WHERE source != 'manual' AND source_id IS NOT NULL AND status IN ${WATCHED_SQL} ORDER BY id LIMIT 6000`).all()
				: db.prepare(`SELECT source, source_id AS id, title, NULL AS rating FROM profile_titles WHERE profile = ? AND status IN ${WATCHED_SQL} ORDER BY id LIMIT 6000`).all(profile)
		) as { source: string; id: string; title: string; rating: number | null }[];
		const items = rows.map((r) => ({ key: `${r.source}:${r.id}`, title: r.title, rating: r.rating })).filter((i) => SEEN_KEY.test(i.key) && i.key.length <= 40);
		const now = JSON.stringify(items);
		// (A profile with nothing watched that never sent anything has nothing to take back either.)
		if (seenSent.get(profile) === now || (!items.length && !seenSent.has(profile) && profile !== 0)) continue;
		let ok = true;
		for (let at = 0; (at < items.length || at === 0) && ok; at += 300) {
			ok = (await cloud('/v1/seen', { method: 'PUT', profile, body: { reset: at === 0, add: items.slice(at, at + 300) }, timeout: 30_000 })).ok;
		}
		if (ok) seenSent.set(profile, now);
	}
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
				const when = new Date(row.updated).toISOString().slice(0, 19).replace('T', ' ');
				const poster = /^https:\/\/image\.tmdb\.org\//.test(row.value?.p ?? '') ? row.value.p! : '';
				const result = take.run(profile, title, type === 'tv' ? 'tv' : 'movie', Number(season) || 0, Number(episode) || 0, place, duration, poster, when);
				if (result.changes) got++;
			}
			rev = answer.data.rev;
			if (!answer.data.more) break;
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

let started = false;

/** Says hello, shares what each profile has watched (looked at every 10 minutes, sent when it changed), and keeps the synced profiles in step every two minutes. */
export function startOnline(): void {
	if (started || !onlineConnected()) return;
	started = true;
	const hello = () => void cloud('/v1/hello', { profile: 0, body: { house: houseName() } });
	setTimeout(hello, 20_000).unref?.();
	setTimeout(() => void shareSeen().catch(() => {}), 90_000).unref?.();
	setInterval(() => void shareSeen().catch(() => {}), 10 * 60 * 1000).unref?.();
	setInterval(() => {
		for (const profile of syncProfiles()) void syncNow(profile);
	}, 2 * 60 * 1000).unref?.();
	setTimeout(() => {
		for (const profile of syncProfiles()) void syncNow(profile);
	}, 30_000).unref?.();
	// Libraries kept in step, by their own switch (librarySync.ts).
	void import('./librarySync').then((m) => m.startLibrarySync()).catch(() => {});
}
