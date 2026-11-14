/**
 * New episodes of shows someone has caught up with.
 *
 * When an episode is watched to the end and the player has nothing after it to play, the show
 * is caught up (`caught_up`, written by the player through /api/watch/caught-up) and leaves
 * Continue Watching. Every few hours this looks again, per show, and when a later episode can
 * now be played the show comes back to Continue Watching at that episode, marked new — on the
 * computer and the TV, for every profile. Nothing depends on a show being marked Watching or on
 * the air: what was watched in Catalog decides.
 *
 * "Can be played" is the player's own answer (its lookup, without the video link), so an episode
 * TMDB says has aired but no source has yet ("Airs …" in the player) doesn't count until it can.
 * That lookup lists Febbox folders, which Febbox only allows so many of (febboxList.ts), so it's
 * only asked for when TMDB says something aired lately — a show between seasons, or ended, costs
 * one TMDB request — one show at a time, well spaced.
 *
 * A new episode found is also fetched onto this computer there and then, where it will play from
 * 7Movies or Movy (`getReady`): their servers are slow over an episode nobody has played yet, so
 * the newest episode of a show was the one that buffered, week after week (SVU on a Fire TV,
 * 2026-10-17 to 2026-11-13). Every other episode is fetched while the one before it plays; the
 * newest has none before it that evening.
 */
import { caughtUpChecked, caughtUpWaiting, newEpisodesFound, type CaughtUp } from './db/queries';
import { downloadCopyAhead } from './downloadAheadAsk';
import { downloadKindOf, piecesHeld } from './episodeDownloads';
import { pickFile, PREFERRED_QUALITY } from '$lib/watch';
import { tmdbShow } from './combinedEpisodes';
import { tmdbGet } from './metadata/tmdb';
import { ownFetch, ownPortKnown } from './ownFetch';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** How often every caught-up show is looked at. */
const ROUND_EVERY = 6 * HOUR;
/** A show looked at less recently than this is looked at again. */
const LOOK_AGAIN = 12 * HOUR;
/** Something TMDB says aired this long before the show was caught up still gets looked for. */
const AIRED_LATELY = 14 * DAY;
/** Between one show's lookup and the next. */
const SPACING_MS = 20_000;


type ListedFile = { fid: number; quality: string; size: string; name?: string; source?: string; audio?: string; hevc?: boolean; shareKey?: string };
type Listed = { season: number; episode: number; available?: boolean; files?: ListedFile[] };
type Spot = { season: number; episode: number; files?: ListedFile[] };

/** A new episode stays on this computer this long if nobody plays it (then it plays the usual way). */
const KEEP_NEW = 8 * DAY;
/** The copies being fetched for each new episode ("title|year|season|episode"), while Catalog runs. */
const gettingReady = new Map<string, string[]>();
/** New episodes that were all here once (watched since, perhaps: not fetched a second time). */
const wasReady = new Set<string>();
/** How many times each has been started on: a source that never has all of it isn't asked forever. */
const readyTries = new Map<string, number>();
const MOST_TRIES = 16;
/** New episodes not all here yet, with their copies as last listed: tried again without another lookup. */
const pending = new Map<string, { title: string; year: string; spot: Spot }>();
/** How often those are tried again (a source often has no link for an episode's first day: 7Movies answered 502 for SVU's newest, 2026-11-13). */
const TRY_AGAIN_EVERY = 30 * 60 * 1000;

const keyOf = (title: string, year: string, spot: { season: number; episode: number }) => `${title.toLowerCase()}|${year}|${spot.season}|${spot.episode}`;

/** Whether a new episode needs (more) fetching: not when it's all here, or was, or has been tried enough. */
function wantsFetching(key: string): boolean {
	if (wasReady.has(key)) return false;
	const copies = gettingReady.get(key);
	const here = copies?.length
		? copies.every((copy) => {
				const held = piecesHeld(copy);
				return held !== null && held.total > 0 && held.held.length >= held.total;
			})
		: false;
	if (here) {
		wasReady.add(key);
		pending.delete(key);
	}
	return !here && (readyTries.get(key) ?? 0) < MOST_TRIES;
}

/**
 * A new episode, fetched onto this computer before anyone plays it: the copy the player will
 * pick, when that's 7Movies' or Movy's (Showbox's comes straight from Febbox, fast as it is).
 * Asked again each round until all of it is here: Catalog may have been closed partway.
 */
async function getReady(title: string, year: string, spot: Spot): Promise<void> {
	const key = keyOf(title, year, spot);
	if (!wantsFetching(key)) return;
	const files = spot.files ?? [];
	const file = pickFile(files, PREFERRED_QUALITY);
	// Showbox's copy is the one that will play: nothing to fetch.
	if (!file?.source) return;
	pending.set(key, { title, year, spot });
	readyTries.set(key, (readyTries.get(key) ?? 0) + 1);
	// The copy the player will pick; if its source has no link just now, the next one that's
	// downloaded this way (the player falls back to it the same way).
	const downloadable = (f: ListedFile) => Boolean(f.shareKey && downloadKindOf(f.shareKey) && !f.hevc);
	for (const copy of [file, ...files.filter((f) => f !== file)].filter(downloadable)) {
		const started = await downloadCopyAhead(copy.shareKey!, copy.fid, Date.now() + KEEP_NEW);
		if (!started.length) continue;
		gettingReady.set(key, started);
		return;
	}
}

const after = (a: Spot, b: Spot) => a.season > b.season || (a.season === b.season && a.episode > b.episode);

/**
 * The episodes that can be played, in order, as the player lists them — or null when the answer
 * isn't the whole list (Febbox refused a folder just now: another source's numbering may stand in).
 */
async function playableEpisodes(title: string, year: string): Promise<Spot[] | null> {
	if (!ownPortKnown()) return null;
	const params = new URLSearchParams({ title, type: 'tv', year, nostream: '1' });
	try {
		const resp = await ownFetch(`/api/watch/resolve?${params}`, { signal: AbortSignal.timeout(120_000) });
		if (!resp.ok) return null;
		const data = await resp.json();
		if (data?.error || data?.showboxBusy || data?.episodes?.partial) return null;
		const listed: Listed[] = data?.episodes?.episodes ?? [];
		if (!listed.length) return null;
		return listed
			.filter((e) => e.season > 0 && e.available !== false && (e.files?.length ?? 0) > 0)
			.map((e) => ({ season: e.season, episode: e.episode, files: e.files }));
	} catch {
		return null;
	}
}

/** What TMDB says about the show's airing: whether it's over, and the newest episode's air date. */
async function airing(title: string, year: string): Promise<{ ended: boolean; lastAired: string | null } | null> {
	const show = await tmdbShow(title, year).catch(() => null);
	if (!show) return null;
	type Details = { status?: string; last_episode_to_air?: { air_date?: string | null } | null };
	const details = await tmdbGet<Details>(`/tv/${show.id}`);
	if (!details) return null;
	return {
		ended: details.status === 'Ended' || details.status === 'Canceled',
		lastAired: details.last_episode_to_air?.air_date ?? null
	};
}

/** One show (every profile caught up with it). True when the player's lookup was asked. */
async function lookAt(rows: CaughtUp[]): Promise<boolean> {
	const { title, year } = rows[0];
	const tmdb = await airing(title, year);
	const firstLook = rows.some((r) => r.knownSeason === null);
	const earliest = rows.map((r) => Date.parse(`${r.finishedAt.replace(' ', 'T')}Z`)).reduce((a, b) => Math.min(a, b));
	const airedLately = Boolean(tmdb?.lastAired && Date.parse(tmdb.lastAired) >= earliest - AIRED_LATELY);

	// Nothing aired lately: nothing new to look for. A first look at an ended show (or one TMDB
	// doesn't know) takes the episode watched as the last there is.
	if (!airedLately && !(firstLook && tmdb && !tmdb.ended)) {
		for (const row of rows) {
			caughtUpChecked(row, row.knownSeason === null ? { season: row.season, episode: row.episode } : null, null);
		}
		return false;
	}

	const playable = await playableEpisodes(title, year);
	// Not a whole answer: looked at again next round, not marked as looked at.
	if (!playable) return true;
	const last = playable.at(-1) ?? null;
	for (const row of rows) {
		// A first look only learns what's there: an episode already out isn't news.
		const known = row.knownSeason !== null && row.knownEpisode !== null ? { season: row.knownSeason, episode: row.knownEpisode } : null;
		const isNew = known !== null && last !== null && after(last, known);
		const next = isNew ? (playable.find((e) => after(e, row)) ?? null) : null;
		caughtUpChecked(row, known ? null : last, next);
		if (next) void getReady(title, year, next).catch(() => {});
	}
	return true;
}

/** For /api/diagnostics: each new episode being fetched ahead, how much of it is here, and how many tries. */
export function newEpisodeFetches(): unknown[] {
	const keys = new Set([...gettingReady.keys(), ...pending.keys(), ...readyTries.keys()]);
	return [...keys].map((key) => ({
		episode: key,
		tries: readyTries.get(key) ?? 0,
		allHere: wasReady.has(key),
		copies: (gettingReady.get(key) ?? []).map((copy) => {
			const held = piecesHeld(copy);
			return { copy, here: held?.held.length ?? 0, of: held?.total ?? 0, downloading: held?.going ?? 0 };
		})
	}));
}

let running = false;

/** Looks at every caught-up show due a look, one at a time. */
export async function checkNewEpisodes(): Promise<void> {
	if (running) return;
	running = true;
	try {
		const due = caughtUpWaiting().filter((r) => !r.checkedAt || Date.now() - Date.parse(`${r.checkedAt.replace(' ', 'T')}Z`) > LOOK_AGAIN);
		const shows = new Map<string, CaughtUp[]>();
		for (const row of due) {
			const key = `${row.title.toLowerCase()}|${row.year}`;
			shows.set(key, [...(shows.get(key) ?? []), row]);
		}
		for (const rows of shows.values()) {
			const asked = await lookAt(rows).catch((e) => {
				console.error('[new-episodes]', rows[0].title, e);
				return false;
			});
			if (asked) await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
		}
		// New episodes found on an earlier round and not all here yet (Catalog was closed, or the
		// source hadn't all of it): carried on with.
		for (const found of newEpisodesFound(KEEP_NEW / DAY)) {
			const key = keyOf(found.title, found.year, found);
			// (Ones being tried again between rounds need no fresh lookup.)
			if (pending.has(key) || !wantsFetching(key)) continue;
			const playable = await playableEpisodes(found.title, found.year);
			const spot = playable?.find((e) => e.season === found.season && e.episode === found.episode);
			if (spot) await getReady(found.title, found.year, spot).catch(() => {});
			await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
		}
	} finally {
		running = false;
	}
}

let started = false;

/** A few minutes after start (the app's own start-up work first), then every six hours. */
export function scheduleNewEpisodeChecks(): void {
	if (started) return;
	started = true;
	const run = () => checkNewEpisodes().catch((e) => console.error('[new-episodes]', e));
	setTimeout(run, 3 * 60 * 1000).unref?.();
	setInterval(run, ROUND_EVERY).unref?.();
	// New episodes still being fetched: carried on with between rounds.
	setInterval(() => {
		for (const [key, wanted] of pending) {
			if (wantsFetching(key)) void getReady(wanted.title, wanted.year, wanted.spot).catch(() => {});
			else if (!gettingReady.has(key) || wasReady.has(key) || (readyTries.get(key) ?? 0) >= MOST_TRIES) pending.delete(key);
		}
	}, TRY_AGAIN_EVERY).unref?.();
}
