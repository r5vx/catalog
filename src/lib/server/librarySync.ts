/**
 * One person's library in step between their computers (Settings → Online → "Keep my library in
 * step"), through the meeting point's synced rows (kind "entry", one per title, newest wins), the
 * same store watch progress uses (online.ts `syncNow`).
 *
 * What goes: for the owner's profile, each library entry's status, rating, favorite, rewatches,
 * review, started and finished dates and the episode reached; for any other profile, their own list
 * (status and episode reached). A title new to a computer is added with its name, year, category
 * and poster; its tags, cast and details are then looked up here, as for anything added.
 * What never goes: the `settings` table, note pages, downloads, friends' files.
 *
 * Careful by design (the library has been corrupted before):
 * - A title removed by hand on one computer (library_removed) goes from the others too, unless
 *   that computer turned it off (`removalsOn`); only when it wasn't changed there since. At most
 *   MOST_REMOVES a round, and a copy of the library goes into `backups/` the first time each day.
 *   Nothing else is ever deleted.
 * - Titles typed in by name (no TMDB or AniList id) have nothing to match on and stay put.
 * - A copy of the whole library goes into `backups/` before a profile's first round here.
 * - Each round's writes are one transaction, and at most MOST_ADDS titles are added per round.
 * - A title already here only changes when the other computer changed it later.
 * - Never from a page's `load`: only from the background rounds and Settings → Online.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { db, dbPath } from './db/index';
import { readSettings, updateSettings } from './settings';
import { categoryIdForSlug, existingSourceKeysWithIds, insertEntry, listProfiles, noteRemoved } from './db/queries';
import { cloud, everyRound, onlineConnected, profileList } from './online';
import { titleKey } from '$lib/titleKey';
import { STATUSES } from '$lib/constants';

const KIND = 'entry';
/** Titles added per round at most; the rest come in the next round (a few seconds later). */
const MOST_ADDS = 300;
/** Titles removed per round at most, the same way. */
const MOST_REMOVES = 100;
/** The most one row may hold at the meeting point is 24,000 characters: a review longer than this stays here. */
const MOST_VALUE = 23_000;
/** Rows per upload, and characters per upload (the server takes up to 400 rows and 900 KB). */
const ROWS_PER_PUT = 300;
const CHARS_PER_PUT = 600_000;

/** What one title carries. Only the fields given are changed on the other computer. */
type Value = {
	t: string;
	y: number | null;
	c: string;
	s: string;
	p: string | null;
	ls: number | null;
	le: number | null;
	// The library's own (the owner's profile); another profile's list has none of these.
	r?: number | null;
	f?: number;
	w?: number;
	n?: string;
	a?: string | null;
	b?: string | null;
	/** 1: removed by hand (then `s` is "removed", which a Catalog from before removals skips). */
	x?: number;
};

type Local = { key: string; value: Value; updated: number };

export type LibraryRound = { at: number; sent: number; taken: number; added: number; removed: number; skipped: number; left: number; longNotes: number; error: string };
export type LibraryPreview = { here: number; there: number; add: number; update: number; remove: number; send: number; nameOnly: number };

/* ------------------------------------------------------------ the switch, per profile */

/** The profiles kept in step: every profile, unless turned off (on by default since 2026-11-14 night). */
export function libraryProfiles(): number[] {
	const off = new Set(profileList(readSettings().onlineLibraryOff));
	return listProfiles()
		.map((one) => one.id)
		.filter((id) => !off.has(id));
}

/** Whether titles removed on one computer are removed here too (on unless turned off; per computer). */
export const removalsOn = () => readSettings().onlineRemovals !== '0';

/** Turns it on or off for a profile. Turning it on does the first round, and says how it went. */
export async function setLibraryProfile(profile: number, on: boolean): Promise<LibraryRound | null> {
	const off = new Set(profileList(readSettings().onlineLibraryOff));
	if (on) off.delete(profile);
	else off.add(profile);
	updateSettings({ onlineLibraryOff: off.size ? JSON.stringify([...off]) : undefined });
	if (!on) {
		// Turned on again later, it starts over as a whole merge, which is what its preview shows.
		const all = state();
		delete all[String(profile)];
		updateSettings({ onlineLibraryState: Object.keys(all).length ? JSON.stringify(all) : undefined });
	}
	return on ? syncLibrary(profile) : null;
}

type State = Record<string, { pushed: number; rev: number }>;

function state(): State {
	try {
		return JSON.parse(readSettings().onlineLibraryState ?? '{}') as State;
	} catch {
		return {};
	}
}

function saveState(profile: number, value: { pushed: number; rev: number }): void {
	const all = state();
	all[String(profile)] = value;
	updateSettings({ onlineLibraryState: JSON.stringify(all) });
}

/* ------------------------------------------------------------ small helpers */

/** Both kinds of time the library writes ("2026-11-14T10:00:00.000Z" and SQLite's "2026-11-14 10:00:00", which is UTC) as ms. */
function toMs(text: string | null | undefined): number {
	if (!text) return 0;
	const iso = /[zZ]|[+-]\d\d:\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`;
	return Date.parse(iso) || 0;
}

const sqliteTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const KEY = /^(tmdb|anilist):[\w:-]{1,60}$/;
const STATUS_VALUES = new Set<string>(STATUSES.map((s) => s.value));
const int = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 100_000 ? (v as number) : null);
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const poster = (v: unknown) => (typeof v === 'string' && /^https:\/\/[^\s"']{1,500}$/.test(v) ? v : null);

/** Titles typed in by name: nothing to match them on, so they stay on this computer. */
export function nameOnlyCount(profile: number): number {
	if (profile !== 0) return 0;
	return (db.prepare("SELECT COUNT(*) AS n FROM entries WHERE source = 'manual' OR source_id IS NULL OR source_id = ''").get() as { n: number }).n;
}

/** Every title of this profile that can be synced, as it would be sent. */
function localRows(profile: number): Local[] {
	type Row = {
		source: string;
		sourceId: string;
		title: string;
		year: number | null;
		category: string | null;
		status: string;
		poster: string | null;
		ls: number | null;
		le: number | null;
		rating?: number | null;
		favorite?: number;
		rewatches?: number;
		notes?: string;
		started?: string | null;
		finished?: string | null;
		updated: string;
	};
	const rows = (
		profile === 0
			? db
					.prepare(
						`SELECT e.source, e.source_id AS sourceId, e.title, e.year, c.slug AS category, e.status, e.poster_url AS poster,
							e.last_season AS ls, e.last_episode AS le, e.rating, e.favorite, e.rewatches, e.notes,
							e.started_on AS started, e.finished_on AS finished, e.updated_at AS updated
						 FROM entries e LEFT JOIN categories c ON c.id = e.category_id
						 WHERE e.source IN ('tmdb', 'anilist') AND e.source_id IS NOT NULL AND e.source_id != ''`
					)
					.all()
			: db
					.prepare(
						`SELECT source, source_id AS sourceId, title, year, category, status, poster_url AS poster,
							last_season AS ls, last_episode AS le, updated_at AS updated
						 FROM profile_titles WHERE profile = ? AND source IN ('tmdb', 'anilist')`
					)
					.all(profile)
	) as Row[];
	const out: Local[] = [];
	for (const row of rows) {
		const key = `${row.source}:${row.sourceId}`;
		if (!KEY.test(key)) continue;
		const value: Value = { t: row.title, y: row.year ?? null, c: row.category ?? '', s: row.status, p: row.poster ?? null, ls: row.ls ?? null, le: row.le ?? null };
		if (profile === 0) {
			value.r = row.rating ?? null;
			value.f = row.favorite ? 1 : 0;
			value.w = row.rewatches ?? 0;
			value.n = row.notes ?? '';
			value.a = row.started ?? null;
			value.b = row.finished ?? null;
		}
		out.push({ key, value, updated: toMs(row.updated) });
	}
	// Removed by hand here (and not added again since): sent as removals.
	const here = new Set(out.map((row) => row.key));
	const removed = db
		.prepare('SELECT source, source_id AS sourceId, title, year, removed_at AS at FROM library_removed WHERE profile = ?')
		.all(profile) as { source: string; sourceId: string; title: string; year: number | null; at: number }[];
	for (const row of removed) {
		const key = `${row.source}:${row.sourceId}`;
		if (!KEY.test(key) || here.has(key)) continue;
		out.push({ key, value: { t: row.title, y: row.year ?? null, c: '', s: 'removed', p: null, ls: null, le: null, x: 1 }, updated: row.at });
	}
	return out.sort((a, b) => a.updated - b.updated);
}

/** Whether the meeting point keeps library rows yet (it needed an update for them). Asked once per 10 minutes. */
let serverKnown: { at: number; library: boolean } | null = null;
async function serverReady(): Promise<boolean> {
	if (serverKnown && Date.now() - serverKnown.at < 10 * 60_000) return serverKnown.library;
	const answer = await cloud<{ library?: number }>('/v1/info', { open: true, timeout: 10_000 });
	if (!answer.ok) return false;
	serverKnown = { at: Date.now(), library: answer.data?.library === 1 };
	return serverKnown.library;
}
const NOT_READY = 'The meeting point needs an update before libraries can be kept in step';

type Remote = { key: string; value: Value; updated: number; rev: number };

/** This person's library rows at the meeting point changed since `since` (all of them from 0). */
async function remoteRows(profile: number, since: number): Promise<{ rows: Remote[]; rev: number; error: string }> {
	const rows: Remote[] = [];
	let rev = since;
	for (let page = 0; page < 30; page++) {
		const answer = await cloud<{ rows: (Remote & { kind: string })[]; rev: number; more: boolean }>(`/v1/sync?since=${rev}&kind=${KIND}`, { profile, timeout: 30_000 });
		if (!answer.ok || !answer.data) return { rows, rev, error: answer.error || 'No answer' };
		for (const row of answer.data.rows) if (row.kind === KIND) rows.push(row);
		rev = answer.data.rev;
		if (!answer.data.more) break;
	}
	return { rows, rev, error: '' };
}

/* ------------------------------------------------------------ matching a title from the other computer */

type Here = { id: number; updated: number } | null;

/**
 * Finds a title here: by its site and id, else (the other site's copy of an anime) by name and
 * year. Asks the library as it is now, so a title added earlier in the same round is found too.
 */
function matcher(profile: number): (key: string, value: Value) => Here {
	if (profile === 0) {
		const keys = existingSourceKeysWithIds();
		const byKey = db.prepare("SELECT id, updated_at AS updated FROM entries WHERE source = ? AND source_id = ?");
		const byId = db.prepare('SELECT id, updated_at AS updated FROM entries WHERE id = ?');
		const byName = db.prepare('SELECT id, updated_at AS updated FROM entries WHERE lower(title) = lower(?) AND year = ? LIMIT 1');
		return (key, value) => {
			const at = key.indexOf(':');
			const known = keys[key] ?? (value.t && value.y ? keys[titleKey(value.t, value.y)] : undefined);
			const row = (byKey.get(key.slice(0, at), key.slice(at + 1)) ??
				(known ? byId.get(known) : undefined) ??
				(value.t && value.y ? byName.get(value.t, value.y) : undefined)) as { id: number; updated: string } | undefined;
			return row ? { id: row.id, updated: toMs(row.updated) } : null;
		};
	}
	const byKey = db.prepare('SELECT id, updated_at AS updated FROM profile_titles WHERE profile = ? AND source = ? AND source_id = ?');
	const byName = db.prepare('SELECT id, updated_at AS updated FROM profile_titles WHERE profile = ? AND lower(title) = lower(?) AND year = ? LIMIT 1');
	return (key, value) => {
		const at = key.indexOf(':');
		const row = (byKey.get(profile, key.slice(0, at), key.slice(at + 1)) ?? (value.t && value.y ? byName.get(profile, value.t, value.y) : undefined)) as
			| { id: number; updated: string }
			| undefined;
		return row ? { id: row.id, updated: toMs(row.updated) } : null;
	};
}

/* ------------------------------------------------------------ what's about to happen, before the first round */

/** The counts shown before the first round ("412 here, 380 there: 35 added here…"). Changes nothing. */
export async function libraryPreview(profile: number): Promise<{ preview: LibraryPreview | null; error: string }> {
	if (!onlineConnected()) return { preview: null, error: "This Catalog isn't online" };
	if (!(await serverReady())) return { preview: null, error: NOT_READY };
	const remote = await remoteRows(profile, 0);
	if (remote.error) return { preview: null, error: remote.error };
	const local = localRows(profile);
	const find = matcher(profile);
	const there = new Map(remote.rows.map((r) => [r.key, r]));
	let add = 0;
	let update = 0;
	let remove = 0;
	for (const row of there.values()) {
		const here = find(row.key, row.value);
		if (row.value?.x === 1) {
			if (here && removalsOn() && row.updated > here.updated) remove++;
		} else if (!here) add++;
		else if (row.updated > here.updated) update++;
	}
	let send = 0;
	for (const row of local) {
		const theirs = there.get(row.key);
		if (!theirs || row.updated > theirs.updated) send++;
	}
	const titles = (rows: { value: Value }[]) => rows.filter((row) => row.value?.x !== 1).length;
	return { preview: { here: titles(local), there: titles([...there.values()]), add, update, remove, send, nameOnly: nameOnlyCount(profile) }, error: '' };
}

/* ------------------------------------------------------------ a round */

/** The round under way for each profile: asking again meanwhile waits for it and gets its answer. */
const syncing = new Map<number, Promise<LibraryRound>>();
/** Each profile's last round (Settings → Online and /api/diagnostics show it). */
export const lastLibrarySync = new Map<number, LibraryRound>();
/** What this run took from the other computers (profile|key → its time), so it isn't sent straight back. */
const justTaken = new Map<string, number>();

function backupFirst(profile: number): void {
	backupAs(`library-before-library-sync-${profile}-${new Date().toISOString().slice(0, 10)}.db`);
}

/** Before the first title a day is removed by sync: a copy of the whole library, to undo it by hand. */
function backupBeforeRemoving(profile: number): void {
	backupAs(`library-before-sync-removals-${profile}-${new Date().toISOString().slice(0, 10)}.db`);
}

function backupAs(name: string): void {
	const dir = join(dirname(dbPath), 'backups');
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const file = join(dir, name);
	if (existsSync(file)) return;
	// (Inside the round's transaction VACUUM can't run: the copy is made first, from outside it.)
	db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
}

/**
 * How far the sending has got, as a time: every title changed up to it has gone. The first `count`
 * of `changed` (oldest first) have gone; when the next one shares the last one's time, the time
 * before it, so a stop between the two never leaves one behind.
 */
function sentUpTo(changed: Local[], count: number, before: number): number {
	const next = changed[count]?.updated ?? Infinity;
	for (let i = count - 1; i >= 0; i--) if (changed[i].updated < next) return Math.max(before, changed[i].updated);
	return before;
}

/** The value as it may be sent: a review too long for the meeting point is left out (and so left alone there). */
function forSending(row: Local): { value: Value; longNotes: boolean } {
	if (JSON.stringify(row.value).length <= MOST_VALUE) return { value: row.value, longNotes: false };
	const { n: _left, ...rest } = row.value;
	return { value: rest, longNotes: true };
}

/**
 * One round for one profile: what changed here goes out, then what changed on the other computers
 * comes in (newest wins; titles new here are added, up to MOST_ADDS a round). Returns what it did.
 */
export function syncLibrary(profile: number): Promise<LibraryRound> {
	const under = syncing.get(profile);
	if (under) return under;
	const round = oneRound(profile).finally(() => syncing.delete(profile));
	syncing.set(profile, round);
	return round;
}

async function oneRound(profile: number): Promise<LibraryRound> {
	const blank: LibraryRound = { at: Date.now(), sent: 0, taken: 0, added: 0, removed: 0, skipped: 0, left: 0, longNotes: 0, error: '' };
	if (!onlineConnected() || !libraryProfiles().includes(profile)) return { ...blank, error: 'Library sync is off' };
	const round = { ...blank };
	const done = (error = '') => {
		round.error = error;
		round.at = Date.now();
		lastLibrarySync.set(profile, round);
		return round;
	};
	try {
		if (!(await serverReady())) return done(NOT_READY);
		const before = state()[String(profile)];
		if (!before) backupFirst(profile);
		const { pushed: pushedBefore, rev: revBefore } = before ?? { pushed: 0, rev: 0 };

		// Out: titles changed here since the last round, oldest first, a few hundred to an upload.
		const changed = localRows(profile).filter((r) => r.updated > pushedBefore && justTaken.get(`${profile}|${r.key}`) !== r.updated);
		let pushed = pushedBefore;
		let at = 0;
		while (at < changed.length) {
			const part: { kind: string; key: string; value: Value; updated: number }[] = [];
			let chars = 0;
			for (; at < changed.length && part.length < ROWS_PER_PUT; at++) {
				const { value, longNotes } = forSending(changed[at]);
				const size = JSON.stringify(value).length + 120;
				if (part.length && chars + size > CHARS_PER_PUT) break;
				if (longNotes) round.longNotes++;
				part.push({ kind: KIND, key: changed[at].key, value, updated: changed[at].updated });
				chars += size;
			}
			const answer = await cloud('/v1/sync', { method: 'PUT', profile, timeout: 30_000, body: { rows: part } });
			if (!answer.ok) {
				saveState(profile, { pushed, rev: revBefore });
				return done(answer.error);
			}
			round.sent += part.length;
			pushed = sentUpTo(changed, at, pushed);
		}

		// In: what changed on this person's other computers.
		const remote = await remoteRows(profile, revBefore);
		if (remote.error) {
			saveState(profile, { pushed, rev: revBefore });
			return done(remote.error);
		}
		const find = matcher(profile);
		let rev = revBefore;
		const added: number[] = [];
		// When each title removed here was removed.
		const removedHere = new Map(
			(db.prepare('SELECT source, source_id AS sourceId, removed_at AS at FROM library_removed WHERE profile = ?').all(profile) as { source: string; sourceId: string; at: number }[]).map(
				(r) => [`${r.source}:${r.sourceId}`, r.at]
			)
		);
		// Removals coming: the day's copy of the library first (VACUUM can't run inside the transaction).
		if (removalsOn() && remote.rows.some((row) => row.value?.x === 1)) backupBeforeRemoving(profile);
		db.exec('BEGIN');
		try {
			for (const [index, row] of remote.rows.entries()) {
				const value = row.value;
				// Removed by hand on another computer: gone here too, when it wasn't changed here since.
				if (KEY.test(row.key) && value && typeof value === 'object' && value.x === 1) {
					const here = removalsOn() ? find(row.key, value) : null;
					if (here && row.updated > here.updated) {
						if (round.removed >= MOST_REMOVES) {
							round.left = remote.rows.length - index;
							rev = row.rev - 1;
							break;
						}
						remove(profile, here.id, row);
						round.removed++;
					} else round.skipped++;
					justTaken.set(`${profile}|${row.key}`, row.updated);
					rev = row.rev;
					continue;
				}
				if (!KEY.test(row.key) || !value || typeof value !== 'object' || typeof value.t !== 'string' || !STATUS_VALUES.has(value.s)) {
					round.skipped++;
					rev = row.rev;
					continue;
				}
				const here = find(row.key, value);
				// Removed here after the other computer last changed it: stays removed (this removal goes out).
				if (!here && (removedHere.get(row.key) ?? 0) >= row.updated) {
					round.skipped++;
					rev = row.rev;
					continue;
				}
				if (!here) {
					if (round.added >= MOST_ADDS) {
						// The rest next round, from this row on. Rows sent together share one number there,
						// so the next round asks from just before it (the ones already done change nothing).
						round.left = remote.rows.length - index;
						rev = row.rev - 1;
						break;
					}
					added.push(add(profile, row));
					round.added++;
				} else if (row.updated > here.updated) {
					change(profile, here.id, row);
					round.taken++;
				}
				justTaken.set(`${profile}|${row.key}`, row.updated);
				rev = row.rev;
			}
			if (!round.left) rev = Math.max(rev, remote.rev);
			db.exec('COMMIT');
		} catch (error) {
			db.exec('ROLLBACK');
			saveState(profile, { pushed, rev: revBefore });
			return done(String(error));
		}
		saveState(profile, { pushed, rev });
		if (justTaken.size > 20_000) justTaken.clear();
		// Tags, cast and details for what was added, looked up gently in the background.
		if (added.length && profile === 0) void import('./backfill').then((m) => m.startBackfill()).catch(() => {});
		// More to add: the next round straight after this one.
		if (round.left) setTimeout(() => void syncLibrary(profile), 5000).unref?.();
		return done();
	} catch (error) {
		return done(String(error));
	}
}

/** A title new to this computer, from the other one. Returns its id here. */
function add(profile: number, row: Remote): number {
	const v = row.value;
	const at = row.key.indexOf(':');
	const source = row.key.slice(0, at);
	const sourceId = row.key.slice(at + 1);
	if (profile === 0) {
		const id = insertEntry({
			categoryId: categoryIdForSlug(typeof v.c === 'string' ? v.c : ''),
			title: v.t.slice(0, 300),
			year: int(v.y),
			status: v.s,
			rating: typeof v.r === 'number' && v.r >= 0 && v.r <= 10 ? v.r : null,
			rewatches: int(v.w) ?? 0,
			favorite: v.f === 1,
			notes: typeof v.n === 'string' ? v.n : '',
			startedOn: day(v.a),
			finishedOn: day(v.b),
			posterUrl: poster(v.p),
			source,
			sourceId,
			lastSeason: int(v.ls),
			lastEpisode: int(v.le)
		});
		db.prepare('UPDATE entries SET updated_at = ? WHERE id = ?').run(new Date(row.updated).toISOString(), id);
		return id;
	}
	const result = db
		.prepare(
			`INSERT INTO profile_titles (profile, source, source_id, title, year, category, poster_url, overview, status, last_season, last_episode, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?) ON CONFLICT (profile, source, source_id) DO NOTHING`
		)
		.run(profile, source, sourceId, v.t.slice(0, 300), int(v.y), typeof v.c === 'string' && v.c ? v.c : 'movies', poster(v.p), v.s, int(v.ls), int(v.le), sqliteTime(row.updated));
	return Number(result.lastInsertRowid);
}

/**
 * A title here changed on the other computer later than here: its own fields take theirs. What the
 * title is (name, year, category, poster) stays as this computer has it, and a field the other
 * computer didn't send (a review too long to go, or one another profile's list doesn't have) stays too.
 */
function change(profile: number, id: number, row: Remote): void {
	const v = row.value;
	const sets: string[] = [];
	const values: (string | number | null)[] = [];
	const set = (column: string, value: string | number | null) => {
		sets.push(`${column} = ?`);
		values.push(value);
	};
	set('status', v.s);
	if ('ls' in v) set('last_season', int(v.ls));
	if ('le' in v) set('last_episode', int(v.le));
	if (profile === 0) {
		if ('r' in v) set('rating', typeof v.r === 'number' && v.r >= 0 && v.r <= 10 ? v.r : null);
		if ('f' in v) set('favorite', v.f === 1 ? 1 : 0);
		if ('w' in v) set('rewatches', int(v.w) ?? 0);
		if (typeof v.n === 'string') set('notes', v.n);
		if ('a' in v) set('started_on', day(v.a));
		if ('b' in v) set('finished_on', day(v.b));
		// Their time, not now: otherwise this computer would send it back as its own news.
		set('updated_at', new Date(row.updated).toISOString());
		db.prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
		return;
	}
	set('updated_at', sqliteTime(row.updated));
	db.prepare(`UPDATE profile_titles SET ${sets.join(', ')} WHERE id = ? AND profile = ?`).run(...values, id, profile);
}

/**
 * A title removed by hand on the other computer: removed here, noted with their time (so it isn't
 * sent back as news). Tags and cast go with it, as when Remove is pressed here.
 */
function remove(profile: number, id: number, row: Remote): void {
	const at = row.key.indexOf(':');
	const named = { source: row.key.slice(0, at), sourceId: row.key.slice(at + 1), title: String(row.value.t ?? ''), year: int(row.value.y) };
	noteRemoved(profile, named, row.updated);
	if (profile === 0) db.prepare('DELETE FROM entries WHERE id = ?').run(id);
	else db.prepare('DELETE FROM profile_titles WHERE id = ? AND profile = ?').run(id, profile);
}

/* ------------------------------------------------------------ in the background */

let started = false;

/** Every two minutes, each profile with the switch on (started with the rest of Catalog online). */
export function startLibrarySync(): void {
	if (started) return;
	started = true;
	const all = () => {
		for (const profile of libraryProfiles()) void syncLibrary(profile);
	};
	// Every 2 minutes while someone is using this Catalog, every 10 when not (online.ts everyRound).
	everyRound(all, 45_000);
}
