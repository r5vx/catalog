/**
 * What the player gets for a replay (/api/live/replay): its versions that play, named for what
 * they are, and the address of one. Every version is tried at once, and the answer kept 20
 * minutes. A replay none of whose versions play yet is left out of Live TV's lists for an hour
 * (`notReady`): the owner opened Bengals–Ravens hours after it ended and was told it couldn't
 * be played yet, among versions called "Server #1 OK", "Server #3 FM", "Game" and "OK" (2026-10-25).
 * The newest replays are tried ahead, a few at a time, so most never show before they play.
 */
import { replayById, replayList, replayStream, replayVersions, type Replay } from './sources/replays';
import { liveHeadersFor } from './relayHosts';
import { electronFetch } from './electron-fetch';

/**
 * Under this many minutes, a version is a condensed game, not the whole one, by sport: the NFL's
 * condensed games run about 45 minutes (Bengals–Ravens' Dailymotion copy, 44 min, was first called
 * the full game), whole ones about three hours; the NBA's about 15, against two hours.
 */
const CONDENSED_MINUTES: Record<string, number> = { football: 100, basketball: 70, hockey: 80, baseball: 100, soccer: 75 };
const condensedUnder = (sport: string) => CONDENSED_MINUTES[sport] ?? 40;
const KEEP_MS = 20 * 60 * 1000;
const NOT_READY_MS = 60 * 60 * 1000;

export type ReplayAnswer = {
	replay: Omit<Replay, 'page'>;
	/** Each version's name, '' for one that doesn't play (the player asks by position). */
	versions: string[];
	v?: number;
	url?: string;
	/** Minutes, when the version picked is a condensed game. */
	condensed?: number | null;
	error?: string;
};

const answers = new Map<string, { at: number; body: Promise<ReplayAnswer | null> }>();
const notReady = new Map<string, number>();
/** Replays found to have only a condensed game so far: its minutes (Live TV's cards say so). */
const condensedOnly = new Map<string, number>();

export const replayCondensedOnly = (id: string) => condensedOnly.get(id) ?? null;

/** Whether a replay is known not to play yet (left out of the lists for now). */
export const replayNotReady = (id: string) => (notReady.get(id) ?? 0) > Date.now();

export function replayAnswer(id: string, asked: number | null): Promise<ReplayAnswer | null> {
	const key = `${id}|${asked}`;
	const kept = answers.get(key);
	if (kept && Date.now() - kept.at < KEEP_MS) return kept.body;
	const body = lookUp(id, asked).catch(() => null);
	answers.set(key, { at: Date.now(), body });
	// Not playable: asked afresh next time.
	body.then((answer) => {
		if (!answer || answer.error) answers.delete(key);
	});
	return body;
}

async function lookUp(id: string, asked: number | null): Promise<ReplayAnswer | null> {
	const replay = await replayById(id);
	if (!replay) return null;
	const { page: _page, ...shown } = replay;
	const versions = await replayVersions(replay);
	// Every version at once: which play, how long, from where.
	const tried = await Promise.all(
		versions.map(async (version, at) => {
			const url = await replayStream(replay, version).catch(() => null);
			const minutes = url ? await lengthOf(url) : null;
			return { at, url, minutes };
		})
	);
	const seen = new Set<string>();
	const playable = tried.filter((t) => {
		if (!t.url) return false;
		// The same video under two buttons ("Server #1 OK" and "OK") is listed once.
		const video = sameVideo(t.url);
		if (seen.has(video)) return false;
		seen.add(video);
		return true;
	});
	const names = versions.map((_, at) => {
		const t = playable.find((p) => p.at === at);
		if (!t) return '';
		const what = t.minutes !== null && t.minutes < condensedUnder(replay.sport) ? `Condensed, ${Math.round(t.minutes)} min` : 'Full game';
		return `${what} · ${siteOf(t.url!)}`;
	});
	if (!playable.length) {
		notReady.set(id, Date.now() + NOT_READY_MS);
		return {
			replay: shown,
			versions: names,
			error: versions.length ? "This replay can't be played yet. A game only hours old is often still being prepared: try again later." : 'This replay has no video on its page.'
		};
	}
	notReady.delete(id);
	const full = playable.find((t) => t.minutes === null || t.minutes >= condensedUnder(replay.sport));
	const pick = (asked !== null ? playable.find((t) => t.at === asked) : null) ?? full ?? playable[0];
	const condensed = pick.minutes !== null && pick.minutes < condensedUnder(replay.sport) ? Math.round(pick.minutes) : null;
	if (asked === null) {
		if (condensed !== null) condensedOnly.set(id, condensed);
		else condensedOnly.delete(id);
	}
	return { replay: shown, versions: names, v: pick.at, url: pick.url!, condensed };
}

/** The video a relay address is for, without what changes between asks (signatures). */
function sameVideo(relayUrl: string): string {
	try {
		const target = new URL(new URL(relayUrl, 'http://x').searchParams.get('u') ?? '');
		return target.host.replace(/^[^.]+\./, '') + target.pathname.replace(/\/(expires|sig|srcIp|ch|ms)\/[^/]+/g, '');
	} catch {
		return relayUrl;
	}
}

function siteOf(relayUrl: string): string {
	const host = new URL(new URL(relayUrl, 'http://x').searchParams.get('u') ?? 'http://x').host;
	if (/vkuser|okcdn|ok\.ru|mycdn/.test(host)) return 'ok.ru';
	if (/dailymotion|dmcdn/.test(host)) return 'Dailymotion';
	return host.replace(/^www\./, '').split('.').slice(-2, -1)[0] || 'Video';
}

/** How long a replay's playlist plays, in minutes (its first quality's pieces), or null. */
async function lengthOf(relayUrl: string): Promise<number | null> {
	try {
		const master = new URL(new URL(relayUrl, 'http://x').searchParams.get('u') ?? '');
		let text = await textOf(master);
		const variant = text.includes('#EXT-X-STREAM-INF') ? text.split('\n').find((l) => l.trim() && !l.startsWith('#')) : null;
		if (variant) text = await textOf(new URL(variant.trim(), master), liveHeadersFor(master));
		const seconds = [...text.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
		return seconds > 0 ? seconds / 60 : null;
	} catch {
		return null;
	}
}

async function textOf(url: URL, headers = liveHeadersFor(url)): Promise<string> {
	// (Dailymotion's first playlist only answers a browser: see the relay.)
	if (/(^|\.)cdndirector\.dailymotion\.com$/.test(url.host)) {
		const answer = await electronFetch(url.href, { headers });
		return answer.status === 200 ? answer.body : '';
	}
	const resp = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
	return resp.ok ? resp.text() : '';
}

/**
 * The newest replays (under a day old, the ones that may not play yet) tried ahead, three at a
 * time and at most twelve a round, so Live TV only lists the ones that play.
 */
export async function checkNewReplays(): Promise<void> {
	const list = await replayList().catch(() => []);
	const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString().slice(0, 10);
	const fresh = list.filter((r) => r.date && r.date >= yesterday && !answers.has(`${r.id}|null`)).slice(0, 12);
	for (let i = 0; i < fresh.length; i += 3) await Promise.all(fresh.slice(i, i + 3).map((r) => replayAnswer(r.id, null)));
}
