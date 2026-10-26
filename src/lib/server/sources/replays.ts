/**
 * Replays of past games (2026-10-25, owner's request: "live sports OR past replays"), played
 * in Catalog's own player, so without the sites' adverts. Picked from FMHY's Sports Replays
 * after trying them (2026-10-25):
 *
 * - **NFL-Video** (nfl-video.com: NFL, college football, CFL) and **Basketball-Video**
 *   (basketball-video.com: NBA, WNBA, college, Euroleague): the same kind of site. A game's page
 *   has "Server #1 (OK)", "Server #2 (DM)"… buttons, each to an advert page whose markup holds
 *   the real player: an ok.ru or Dailymotion one. ok.ru's player page carries the video's
 *   playlist address (`hlsManifestUrl`, up to 720p60; bound to the address that asked, so it
 *   plays through Catalog's relay). A game a few hours old may only have ok.ru's small "mobile"
 *   copy while ok.ru makes the rest: no playlist yet, so the next server is tried.
 *   Dailymotion: its metadata answer (`qualities.auto`).
 * - **SoccerFull** (soccerfull.net): soccer, each match a page with its versions ("Full Match in
 *   En", "Full Match"), each a plain playlist (/hls/<id>.m3u8) whose pieces are MPEG-TS hidden
 *   after a tiny picture (pictureVideo.ts unwraps them in the relay).
 *
 * Not used: WatchReplay (stopped mid-September), ReplayZone's list (its ok.ru and Dailymotion
 * copies stop at September 25 and were taken down; its soccer is SoccerFull's own), hosts that
 * need a click in their player (Filemoon, Byse).
 */
import { createHash } from 'node:crypto';
import { trustLiveHost } from '../relayHosts';
import type { Sport } from '$lib/live';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export type Replay = {
	id: string;
	sport: Sport;
	league: string;
	title: string;
	/** "2026-10-24", when the title says. */
	date: string;
	poster: string | null;
	page: string;
};

type Site = { origin: string; sport: Sport; pages: string[] };
const SITES: Site[] = [
	{ origin: 'https://nfl-video.com', sport: 'football', pages: ['/', '/?page2', '/?page3', '/?page4'] },
	{ origin: 'https://basketball-video.com', sport: 'basketball', pages: ['/', '/?page2', '/?page3', '/?page4'] }
];
const SOCCER = 'https://soccerfull.net';
const SOCCER_PAGES = ['/', '/cate/premier-league', '/cate/champions-league', '/cate/laliga', '/cate/serie-a', '/cate/bundesliga', '/cate/ligue-1', '/cate/europa-league'];

const get = (url: string, referer?: string) =>
	fetch(url, { headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) }, signal: AbortSignal.timeout(20_000) })
		.then((r) => (r.ok ? r.text() : ''))
		.catch(() => '');

const decode = (text: string) =>
	text.replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

const idOf = (page: string) => createHash('sha1').update(page).digest('hex').slice(0, 12);
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "… - October 24, 2026" (or "Octobe 9, 2026": the sites misspell) → "2026-10-24". */
function dateIn(title: string): string {
	const m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(title);
	if (!m) return '';
	const month = MONTHS.findIndex((name) => name.startsWith(m[1].toLowerCase().slice(0, 3)));
	return month < 0 ? '' : `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** "Golden State Warriors vs Phoenix Suns - NBA - Full Game Replay - October 24, 2026" → the game alone. */
const tidyTitle = (title: string) =>
	title
		.replace(/\s*-\s*(Full (Game|Match|Show|Race) Replays?|Full Game).*$/i, '')
		.replace(/\s*-\s*(NBA|WNBA|NFL|NCAA[^-]*|College[^-]*)\s*$/i, '')
		.trim();

const known = new Map<string, Replay>();
let listed: { at: number; replays: Replay[] } | null = null;
const KEEP = 30 * 60 * 1000;

/** The newest replays from every site (a few pages each), newest first; kept half an hour. */
export async function replayList(): Promise<Replay[]> {
	if (listed && Date.now() - listed.at < KEEP) return listed.replays;
	// An older list is answered at once (Replays took 1–2 s to open); the new one comes behind it.
	if (listed) {
		refreshing ??= fetchReplays().catch(() => listed!.replays).finally(() => (refreshing = null));
		return listed.replays;
	}
	return (refreshing ??= fetchReplays().finally(() => (refreshing = null)));
}

let refreshing: Promise<Replay[]> | null = null;
async function fetchReplays(): Promise<Replay[]> {
	const found: Replay[] = [];
	const lists = await Promise.all([
		...SITES.flatMap((site) => site.pages.map((path) => get(site.origin + path).then((html) => ({ site, html })))),
		...SOCCER_PAGES.map((path) => get(SOCCER + path).then((html) => ({ site: null, html })))
	]);
	for (const { site, html } of lists) {
		if (site) {
			for (const m of html.matchAll(/<div class="short_item[\s\S]*?<img src="([^"]+)"[\s\S]*?<h3><a href="([^"]+)">([^<]+)<\/a><\/h3>[\s\S]*?short_cat">\s*<a href="[^"]+">([^<]+)<\/a>/g)) {
				const page = new URL(m[2], site.origin).href;
				const title = decode(m[3]).trim();
				found.push({ id: idOf(page), sport: site.sport, league: decode(m[4]).trim(), title: tidyTitle(title), date: dateIn(title), poster: new URL(m[1], site.origin).href, page });
			}
		} else {
			for (const m of html.matchAll(/<a href="(\/[^"]+-\d+\.html)"\s+title="([^"]+)"\s*>[\s\S]*?<img[^>]*src="([^"]+)"[\s\S]*?<span class="code[^"]*">([^<]*)<\/span>/g)) {
				const page = SOCCER + m[1];
				found.push({ id: idOf(page), sport: 'soccer', league: decode(m[4]).trim(), title: decode(m[2]).trim(), date: '', poster: new URL(m[3], SOCCER).href, page });
			}
		}
	}
	const seen = new Set<string>();
	const replays = found.filter((r) => !seen.has(r.id) && seen.add(r.id));
	// Newest first: by the date in the title (soccer has none: in the site's own order, after).
	replays.sort((a, b) => (b.date || '0').localeCompare(a.date || '0'));
	for (const r of replays) known.set(r.id, r);
	if (replays.length) listed = { at: Date.now(), replays };
	return replays.length ? replays : (listed?.replays ?? []);
}

export async function replayById(id: string): Promise<Replay | null> {
	if (!known.has(id)) await replayList();
	return known.get(id) ?? null;
}

export type ReplayVersion = { label: string; kind: 'ok' | 'dm' | 'soccer' | 'link'; ref: string };

/** A replay's versions, from its page: the servers ("Server #1 (OK)") or SoccerFull's ("Full Match in En"). */
export async function replayVersions(replay: Replay): Promise<ReplayVersion[]> {
	const html = await get(replay.page);
	if (replay.sport === 'soccer') {
		const versions = [...html.matchAll(/href="[^"]*\?sid=(\d+)" class="video-server[^"]*">([^<]+)</g)].map((m) => ({ label: decode(m[2]).trim(), kind: 'soccer' as const, ref: m[1] }));
		if (versions.length) return versions;
		const only = /\/play\/(\d+)/.exec(html)?.[1];
		return only ? [{ label: 'Full Match', kind: 'soccer', ref: only }] : [];
	}
	const body = html.slice(html.indexOf('fullstory'), html.indexOf('Disclaimer') > 0 ? html.indexOf('Disclaimer') : undefined);
	const versions: ReplayVersion[] = [];
	// Each button, with the words before it ("Server #2 (DM)", or a game's name on a week's page).
	for (const m of body.matchAll(/class="su-button[^"]*" href="(https?:\/\/[^"]+)"|href="(https?:\/\/[^"]+)"[^>]*class="su-button/g)) {
		const link = m[1] ?? m[2];
		// (The words up to this link's own tag, without tags, dashes or the site's separators.)
		const raw = body.slice(Math.max(0, (m.index ?? 0) - 400), m.index);
		const before = decode(
			raw
				.slice(0, raw.lastIndexOf('<a') >= 0 ? raw.lastIndexOf('<a') : undefined)
				.replace(/^[^<]*>/, '')
				.replace(/<[^>]+>/g, ' ')
		)
			.replace(/-{3,}|\bWatch\b/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		const label = /(Server\s*#?\s*\d+[^<|]{0,12})$/i.exec(before)?.[1]?.trim() || before.slice(-60).replace(/^\S*\s/, '').trim() || `Server ${versions.length + 1}`;
		versions.push({ label, kind: 'link', ref: link });
	}
	// A player right in the page, now and then.
	for (const m of body.matchAll(/ok\.ru\/videoembed\/(\d+)/g)) versions.push({ label: `Server ${versions.length + 1}`, kind: 'ok', ref: m[1] });
	return versions;
}

type Stream = { url: string; at: number };
const streams = new Map<string, Stream>();
const STREAM_KEEP = 20 * 60 * 1000;

/**
 * A playable address for a replay's version (`at`: which), through Catalog's relay; null if it
 * can't be played (taken down, still being made). Kept 20 minutes.
 */
export async function replayStream(replay: Replay, version: ReplayVersion): Promise<string | null> {
	const key = `${replay.id}|${version.ref}`;
	const kept = streams.get(key);
	if (kept && Date.now() - kept.at < STREAM_KEEP) return kept.url;
	let kind = version.kind;
	let ref = version.ref;
	if (kind === 'link') {
		// The advert page holds the real player.
		const landing = await get(ref, new URL(replay.page).origin + '/');
		const ok = /ok\.ru\/videoembed\/(\d+)/.exec(landing)?.[1];
		const dm = /dailymotion\.com\/(?:embed\/video\/|player\.html\?video=|video\/)([a-z0-9]+)/i.exec(landing)?.[1];
		if (ok) [kind, ref] = ['ok', ok];
		else if (dm) [kind, ref] = ['dm', dm];
		else return null;
	}
	let playlist: string | null = null;
	let referer = '';
	if (kind === 'ok') {
		const embed = await get(`https://ok.ru/videoembed/${ref}`);
		const options = /data-options="([^"]+)"/.exec(embed)?.[1];
		if (!options) return null;
		try {
			const parsed = JSON.parse(decode(options));
			let meta = parsed.flashvars?.metadata;
			if (typeof meta === 'string') meta = JSON.parse(meta);
			playlist = meta?.hlsManifestUrl ?? null;
		} catch {}
		referer = 'https://ok.ru/';
	} else if (kind === 'dm') {
		const meta = await fetch(`https://www.dailymotion.com/player/metadata/video/${ref}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) })
			.then((r) => r.json())
			.catch(() => null);
		playlist = meta?.qualities?.auto?.[0]?.url ?? null;
		referer = 'https://www.dailymotion.com/';
	} else if (kind === 'soccer') {
		playlist = `${SOCCER}/hls/${ref}.m3u8`;
		referer = `${SOCCER}/play/${ref}`;
	}
	if (!playlist) return null;
	trustLiveHost(playlist, { 'User-Agent': UA, Referer: referer });
	const url = `/api/watch/relay?u=${encodeURIComponent(playlist)}`;
	streams.set(key, { url, at: Date.now() });
	return url;
}
