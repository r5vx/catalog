/**
 * Movy (movy.sx): films and TV that Showbox and 7Movies may not have — old films especially
 * (The She Beast, 2026-10-17). Asked by TMDB id, season and episode, like 7Movies.
 *
 * Its lookups only answer its own page, so the desktop app opens that page out of sight and
 * notes the video playlist its player asks for (electron/main.cjs, `findOnMovy`). It tries its
 * servers in turn: a "yes" in 5–25 s, a "no" once all 13 with the original audio have failed
 * (the other 5 only have dubs). Two at once at most. Answers are kept (a "yes" 40 minutes, the
 * video server's links being short-lived; a "no" 6 hours), and a lookup under way is shared —
 * two TVs starting the same thing, or the Watch button and the player, wait on the one.
 *
 * Its video server (sun.paleoak.top at the time) wants movy's address as Referer, so the video
 * comes through Catalog's relay (/api/watch/relay). Ordinary H.264 up to 1080p, 5 s pieces.
 * Only in the desktop app: elsewhere (npm run dev) Movy never has anything.
 */
import type { FileOption } from '../showbox';
import { electronMovyFind } from '../electron-fetch';
import { trustVideoHost } from '../relayHosts';

const SITE = 'https://www.movy.sx';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MINUTE = 60 * 1000;

/** What movy's video server expects to be asked with. */
export const MOVY_HEADERS = { 'User-Agent': UA, Referer: `${SITE}/` };

type What = { type: 'tv' | 'movie'; id: number; season: number; episode: number };

/** A Movy copy's share key: `movy:<tv|movie>:<TMDB id>:<season>:<episode>`. */
export function movyShareKey(what: What): string {
	return `movy:${what.type}:${what.id}:${what.season}:${what.episode}`;
}

export function parseMovyShareKey(shareKey: string): What | null {
	const m = shareKey.match(/^movy:(tv|movie):(\d+):(\d+):(\d+)$/);
	if (!m) return null;
	return { type: m[1] as 'tv' | 'movie', id: Number(m[2]), season: Number(m[3]), episode: Number(m[4]) };
}

/** Movy's copy of a film or episode (fid -5). Listed after the other sources' copies. */
export function movyCopy(what: What): FileOption {
	return { fid: -5, quality: 'HD', name: 'Movy', size: '', source: 'Movy', shareKey: movyShareKey(what) };
}

const pageFor = (what: What) =>
	what.type === 'tv' ? `${SITE}/tv/${what.id}/${what.season}/${what.episode}?play=true` : `${SITE}/movie/${what.id}?play=true`;

const known = new Map<string, { at: number; url: string | null }>();

/**
 * Lookups take turns, two at a time (each is a page open on the computer for up to 50 s).
 *
 * Something about to play is "urgent": it goes to the front, and if both places are taken by
 * Watch-button checks, one of those makes way at once (it goes back in line, so its title is
 * still checked). Before, a film picked to play waited minutes behind the checks of every
 * title looked at on the way (The Narrow Margin, 2026-10-17: movy itself found it in 5 s).
 *
 * A Watch-button check also has a say (`Wanted`): `start` — still worth starting when its turn
 * comes (no other source has it yet, and its page is still open); `keep` — still worth
 * finishing (its page is still open). Called off otherwise, and nothing is kept about it.
 */
export type Wanted = { start: () => boolean; keep: () => boolean };
type Lookup = { urgent: boolean; wanted: Wanted; result: Promise<string | null>; controller?: AbortController };
type Turn = { lookup: Lookup; go: () => void };

const ALWAYS: Wanted = { start: () => true, keep: () => true };
const AT_ONCE = 2;
const asking = new Map<string, Lookup>();
const waiting: Turn[] = [];
const running = new Set<Lookup>();
const MADE_WAY = 'made way';

function nextTurns() {
	while (running.size < AT_ONCE && waiting.length) {
		const turn = waiting.shift()!;
		running.add(turn.lookup);
		turn.lookup.controller = new AbortController();
		turn.go();
	}
	// Something about to play is waiting: a running check makes way for each one.
	let urgentWaiting = waiting.filter((t) => t.lookup.urgent).length;
	for (const lookup of running) {
		if (!urgentWaiting) break;
		if (lookup.urgent || lookup.controller!.signal.aborted) continue;
		lookup.controller!.abort(MADE_WAY);
		urgentWaiting--;
	}
}

function takeTurn(lookup: Lookup): Promise<void> {
	return new Promise((go) => {
		if (lookup.urgent) waiting.unshift({ lookup, go });
		else waiting.push({ lookup, go });
		nextTurns();
	});
}

function done(lookup: Lookup) {
	running.delete(lookup);
	nextTurns();
}

/**
 * The video playlist for a Movy copy, or null when Movy hasn't got it (or didn't answer in
 * time — not kept then, so it's asked again next time). `wanted`: only for the Watch button's
 * check; without it, the lookup is for something about to play.
 */
export function movyStream(shareKey: string, fresh = false, wanted?: Wanted): Promise<string | null> {
	const what = parseMovyShareKey(shareKey);
	if (!what) return Promise.resolve(null);
	const kept = known.get(shareKey);
	if (kept && !fresh) {
		const age = Date.now() - kept.at;
		if (kept.url ? age < 40 * MINUTE : age < 6 * 60 * MINUTE) return Promise.resolve(kept.url);
	}
	const under = asking.get(shareKey);
	if (under) {
		// About to play, and a check of the same thing is already on it: it becomes urgent.
		if (!wanted && !under.urgent) {
			under.urgent = true;
			under.wanted = ALWAYS;
			const at = waiting.findIndex((t) => t.lookup === under);
			if (at > 0) waiting.unshift(...waiting.splice(at, 1));
			nextTurns();
		}
		return under.result;
	}

	const lookup: Lookup = { urgent: !wanted, wanted: wanted ?? ALWAYS, result: Promise.resolve(null) };
	lookup.result = (async () => {
		try {
			for (;;) {
				await takeTurn(lookup);
				const controller = lookup.controller!;
				if (controller.signal.aborted || !lookup.wanted.start()) {
					done(lookup);
					if (controller.signal.reason === MADE_WAY) continue;
					return null;
				}
				const watch = setInterval(() => {
					if (!lookup.wanted.keep()) controller.abort('not wanted');
				}, 1000);
				const found = await lookUp(shareKey, what, controller.signal);
				clearInterval(watch);
				done(lookup);
				// Made way for something about to play: back in line.
				if (controller.signal.aborted && controller.signal.reason === MADE_WAY) continue;
				return found;
			}
		} finally {
			asking.delete(shareKey);
		}
	})();
	asking.set(shareKey, lookup);
	return lookup.result;
}

function lookUp(shareKey: string, what: What, signal: AbortSignal): Promise<string | null> {
	return electronMovyFind(pageFor(what), signal).then(({ url, error }) => {
		if (url) {
			// Its server (and those its playlists name) may now be fetched through the relay.
			trustVideoHost(url, 'movy');
			known.set(shareKey, { at: Date.now(), url });
			return url;
		}
		// Every one of its servers said no: kept 6 hours. Too slow to answer: tried again after
		// 10 minutes. Anything else (called off, not in the desktop app): not kept.
		if (error === 'none') known.set(shareKey, { at: Date.now(), url: null });
		if (error === 'timeout') known.set(shareKey, { at: Date.now() - 6 * 60 * MINUTE + 10 * MINUTE, url: null });
		return null;
	});
}

/** Whether Movy has a film or episode (the Watch button's check). */
export async function onMovy(what: Omit<What, 'season' | 'episode'> & { season?: number; episode?: number }, wanted: Wanted): Promise<boolean> {
	return Boolean(await movyStream(movyShareKey({ season: 0, episode: 0, ...what }), false, wanted));
}
