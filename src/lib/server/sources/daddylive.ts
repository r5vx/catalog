/**
 * Live TV from DaddyLive's 24/7 channels (about 900: ABC, ESPN, TNT, Sky Sports, beIN…), where
 * live games air. Picked from the owner's list (2026-10-24) because its channels are listed in
 * plain markup by number, and every channel plays the same way.
 *
 * - The list: `/24-7-channels.php`, each channel a card (`/watch.php?id=51`, "ABC USA"). Its
 *   address moves (dlive.sx → thedaddy.pk), so the first one is asked and redirects are followed.
 * - A channel's stream: its page `/stream/stream-<n>.php` holds the real player, which works out
 *   the playlist address in scrambled script, and only inside that page. The desktop app opens
 *   the page out of sight and notes the playlist it asks for (electron/liveCapture.cjs), with the
 *   headers it was asked with (Referer/Origin of the player's site). Its token lasts about two
 *   minutes, so it's asked for again 40 s before it runs out.
 * - The pieces are pictures on TikTok's servers in disguise; they go through the relay
 *   (`live` kind), so phones and TVs play them as well.
 */
import { createHash } from 'node:crypto';
import { electronFetch, electronLiveCapture } from '../electron-fetch';
import { getOrderCache, saveOrderCache } from '../db/queries';
import { gameEnds, sportOf, type LiveChannel, type LiveGame, type Sport } from '$lib/live';

const FIRST = 'https://dlive.sx';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** Where the site is now (it moves), learned from the list's redirect. */
let site = FIRST;
let listed: { at: number; channels: { id: number; name: string; sporty: boolean }[] } | null = null;
const LIST_KEEP = 12 * 60 * 60 * 1000;

/**
 * The last good schedule and channel list are kept in the library too: a friend's Live TV showed
 * 0 games and 0 channels, even after starting Catalog again, when the site couldn't be reached
 * from his computer (2026-10-26). Now a start with the site out of reach shows the last copy.
 */
const KEPT_CHANNELS = 'live-channels';
const KEPT_SCHEDULE = 'live-schedule';
function keptCopy<T>(key: string): { at: number; value: T } | null {
	try {
		const kept = getOrderCache(key);
		return kept ? { at: kept.at, value: kept.value as T } : null;
	} catch {
		return null;
	}
}

/** Why the site's pages last couldn't be had (empty once they could), for /api/diagnostics. */
let trouble = '';
export function liveListingState() {
	return { site, trouble, channels: listed?.channels.length ?? 0, channelsAt: listed?.at ?? null, games: scheduled?.games.length ?? 0, scheduleAt: scheduled?.at ?? null };
}

/**
 * One of the site's pages (its home page, the channel list). Asked plainly first; when that's
 * refused or can't connect, through the desktop app's browser, which goes out its own way
 * (Chromium's network, its DNS and proxy settings).
 */
async function sitePage(path: string, timeout: number): Promise<string | null> {
	let why = '';
	try {
		const resp = await fetch(`${site}${path}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeout) });
		if (resp.ok) {
			site = new URL(resp.url).origin;
			trouble = '';
			return await resp.text();
		}
		why = `HTTP ${resp.status}`;
	} catch (e) {
		why = String((e as Error)?.cause ?? (e as Error)?.message ?? e);
	}
	const viaApp = await electronFetch(`${site}${path}`, { headers: { 'User-Agent': UA } }).catch(() => null);
	if (viaApp && viaApp.status >= 200 && viaApp.status < 300 && viaApp.body) {
		trouble = `${path}: plain fetch failed (${why}), the app's browser worked`;
		return viaApp.body;
	}
	trouble = `${path}: ${why}; app's browser: ${viaApp ? viaApp.error || `HTTP ${viaApp.status}` : 'no answer'} (${new Date().toISOString()})`;
	return null;
}

const SPORTS_CHANNEL = /\b(sports?|espn|nba|nfl|nhl|mlb|mls|ufc|wwe|nfl|bein|dazn|tnt sports|sky sports|bt sport|eurosport|tennis|golf|f1|formula|racing|motor|cricket|rugby|fight|boxing|arena|premier|la ?liga|serie a|bundesliga|ligue|sportsnet|tsn|supersport|fox soccer|soccer|football|nbc sports|cbs sports|big ten|sec network|acc network|pac-12|willow|astro|canal\+ sport|movistar|ziggo|setanta|abu dhabi sports|ssc|alkass|nfl network|redzone|nba tv|mlb network|nhl network|tyc|claro sports|directv sports|tudn|espn deportes)\b/i;

/**
 * The 24/7 channels as listed, sports ones first then A–Z (kept 12 hours). Once known, an old
 * list is answered at once while the new one is fetched (Live TV took 3–5 s to open each time).
 */
let listing: Promise<unknown> | null = null;
async function listedChannels(): Promise<{ id: number; name: string; sporty: boolean }[]> {
	if (!listed) {
		const kept = keptCopy<{ id: number; name: string; sporty: boolean }[]>(KEPT_CHANNELS);
		if (kept?.value?.length) listed = { at: kept.at, channels: kept.value };
	}
	if (listed && Date.now() - listed.at < LIST_KEEP) return listed.channels;
	if (listed) {
		listing ??= fetchChannelList().catch(() => {}).finally(() => (listing = null));
		return listed.channels;
	}
	return fetchChannelList();
}

async function fetchChannelList(): Promise<{ id: number; name: string; sporty: boolean }[]> {
	const html = await sitePage('/24-7-channels.php', 20_000);
	if (html === null) return listed?.channels ?? [];
	const channels: { id: number; name: string; sporty: boolean }[] = [];
	const seen = new Set<number>();
	for (const card of html.matchAll(/href="\/watch\.php\?id=(\d+)"[\s\S]{0,300}?card__title">([^<]+)</g)) {
		const id = Number(card[1]);
		if (seen.has(id)) continue;
		seen.add(id);
		const name = decode(card[2].trim());
		channels.push({ id, name, sporty: SPORTS_CHANNEL.test(name) });
	}
	channels.sort((a, b) => Number(b.sporty) - Number(a.sporty) || a.name.localeCompare(b.name));
	if (channels.length) {
		listed = { at: Date.now(), channels };
		saveOrderCache(KEPT_CHANNELS, channels, listed.at);
	} else trouble = `/24-7-channels.php: no channels in the page (${new Date().toISOString()})`;
	return channels.length ? channels : (listed?.channels ?? []);
}

/**
 * The 24/7 channels, each with the sports it's for: what its name says ("NBA TV"), and what the
 * schedule has it showing today or tomorrow.
 */
export async function liveChannels(games: LiveGame[] = []): Promise<LiveChannel[]> {
	const channels = await listedChannels();
	const showing = new Map<number, Set<Sport>>();
	for (const game of games) {
		for (const channel of game.channels) {
			if (!showing.has(channel.id)) showing.set(channel.id, new Set());
			showing.get(channel.id)!.add(game.sport);
		}
	}
	return channels.map(({ id, name, sporty }) => {
		const sports = new Set(showing.get(id));
		const named = sportOf(name);
		if (named) sports.add(named);
		else if (sporty && !sports.size) sports.add('other');
		return { id, name, sports: [...sports], country: countryOf(name) };
	});
}

// The last word of most channel names says where it's from ("Sky Sports Main Event UK").
const COUNTRIES: Record<string, string> = {
	usa: 'USA', us: 'USA', uk: 'UK', ca: 'Canada', canada: 'Canada', au: 'Australia', australia: 'Australia',
	nz: 'New Zealand', ireland: 'Ireland', ie: 'Ireland', mx: 'Mexico', mexico: 'Mexico', brasil: 'Brazil', brazil: 'Brazil',
	argentina: 'Argentina', spain: 'Spain', es: 'Spain', portugal: 'Portugal', pt: 'Portugal', france: 'France', fr: 'France',
	italy: 'Italy', it: 'Italy', de: 'Germany', germany: 'Germany', nl: 'Netherlands', netherland: 'Netherlands',
	netherlands: 'Netherlands', poland: 'Poland', pl: 'Poland', cz: 'Czechia', sk: 'Slovakia', denmark: 'Denmark',
	sweden: 'Sweden', se: 'Sweden', norway: 'Norway', serbia: 'Serbia', croatia: 'Croatia', bih: 'Bosnia',
	bulgaria: 'Bulgaria', romania: 'Romania', greece: 'Greece', cyprus: 'Cyprus', turkey: 'Turkey', israel: 'Israel',
	russia: 'Russia', arabic: 'Arabic', uae: 'Arabic', qatar: 'Arabic', afrique: 'Africa', malaysia: 'Malaysia',
	pk: 'Pakistan', in: 'India'
};

/** Region codes (Settings → Services → Where to watch) whose short form isn't in the list above. */
const REGIONS: Record<string, string> = {
	gb: 'UK', dk: 'Denmark', no: 'Norway', rs: 'Serbia', hr: 'Croatia', ba: 'Bosnia', bg: 'Bulgaria', ro: 'Romania',
	gr: 'Greece', cy: 'Cyprus', tr: 'Turkey', il: 'Israel', ru: 'Russia', ae: 'Arabic', qa: 'Arabic', sa: 'Arabic',
	my: 'Malaysia', br: 'Brazil', ar: 'Argentina'
};

/** The channels' country name for a Where to watch region ("US" → "USA"), or '' if none match. */
export function countryForRegion(region: string): string {
	const code = region.toLowerCase();
	return REGIONS[code] ?? COUNTRIES[code] ?? '';
}

function countryOf(name: string): string {
	const last = name.replace(/[()]/g, ' ').trim().split(/\s+/).pop()?.toLowerCase() ?? '';
	if (COUNTRIES[last]) return COUNTRIES[last];
	// Big American and Canadian channels whose names don't say so.
	if (/^(espn|fs1|fs2|nfl network|nfl redzone|nba tv|mlb network|nhl network|cbs sports|nbc sports|tnt|tbs|big ten|sec network|acc network)\b/i.test(name)) return 'USA';
	if (/^tsn\d?\b|sportsnet/i.test(name)) return 'Canada';
	return '';
}

let scheduled: { at: number; games: LiveGame[] } | null = null;
const SCHEDULE_KEEP = 20 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * The games on DaddyLive's schedule (its home page) that haven't ended, for about the next day
 * and a half, by start time; kept 20 minutes. The page says its times are UK time, but its own
 * script treats them as GMT and adds the viewer's offset, and they line up with GMT (an ESPN
 * noon game is 16:00 in October, when the UK is an hour ahead), so they're read as GMT.
 */
export async function liveSchedule(): Promise<LiveGame[]> {
	if (!scheduled) {
		const kept = keptCopy<LiveGame[]>(KEPT_SCHEDULE);
		if (kept?.value?.length) scheduled = { at: kept.at, games: kept.value };
	}
	if (scheduled && Date.now() - scheduled.at < SCHEDULE_KEEP) return current(scheduled.games);
	// An older schedule is answered at once; the new one comes behind it.
	if (scheduled) {
		scheduling ??= fetchSchedule().finally(() => (scheduling = null));
		return current(scheduled.games);
	}
	await (scheduling ??= fetchSchedule().finally(() => (scheduling = null)));
	// (Filled in by the fetch just waited on.)
	return current((scheduled as { games: LiveGame[] } | null)?.games ?? []);
}

let scheduling: Promise<void> | null = null;
async function fetchSchedule(): Promise<void> {
	try {
		const html = await sitePage('/', 25_000);
		if (html === null) return;
		const games = readSchedule(html);
		if (games.length) {
			scheduled = { at: Date.now(), games };
			saveOrderCache(KEPT_SCHEDULE, games, scheduled.at);
		} else trouble = `/: no schedule in the page (${new Date().toISOString()})`;
	} catch {}
}

const current = (games: LiveGame[]) => {
	const now = Date.now();
	return games.filter((game) => gameEnds(game) > now && game.start < now + 1.5 * DAY);
};

/** One game on the schedule, by its id, or null. */
export async function liveGame(id: string): Promise<LiveGame | null> {
	return (await liveSchedule()).find((game) => game.id === id) ?? null;
}

function readSchedule(html: string): LiveGame[] {
	const byId = new Map<string, LiveGame>();
	const from = html.indexOf('id="schedule"');
	if (from < 0) return [];
	for (const day of html.slice(from).split('<div class="schedule__dayTitle">').slice(1)) {
		// "Saturday 24th Oct 2026 - Schedule Time UK GMT"; an old day left on the page is skipped.
		const date = /(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\s+(\d{4})/i.exec(day.slice(0, 120));
		if (!date) continue;
		const midnight = Date.UTC(Number(date[3]), MONTHS.indexOf(date[2].toLowerCase()), Number(date[1]));
		if (!(Math.abs(midnight - Date.now()) < 3 * DAY)) continue;
		for (const part of day.split('<div class="schedule__catHeader').slice(1)) {
			const category = tidy(/card__meta">([^<]+)</.exec(part)?.[1] ?? '');
			// A day's list runs on past midnight (GMT): within a league the games go roughly by time,
			// so one hours earlier than the latest so far is the next day. So is an American
			// league's first game in the small hours (8 PM Eastern is midnight GMT).
			const american = AMERICAN.test(category);
			let latest = -1;
			let later = 0;
			for (const event of part.matchAll(/data-time="(\d{1,2}):(\d{2})"[\s\S]*?schedule__eventTitle">([^<]*)<[\s\S]*?schedule__channels">([\s\S]*?)<\/div>/g)) {
				const minutes = Number(event[1]) * 60 + Number(event[2]);
				if (latest >= 0 ? minutes < latest - 6 * 60 : american && minutes < 6 * 60) later = DAY;
				latest = Math.max(latest, minutes);
				const channels = [...event[4].matchAll(/watch\.php\?id=(\d+)"[^>]*>([^<]+)</g)]
					.map((c) => ({ id: Number(c[1]), name: tidy(c[2]).replace(/^Event (SD )?Stream$/i, 'Event stream') }))
					.filter((c, at, all) => c.id > 0 && all.findIndex((other) => other.id === c.id) === at);
				if (!channels.length) continue;
				// "Grand Prix of Malaysia (MotoGP) | Sepang, Malaysia | 1 November 2026": on that day.
				// One that runs for weeks ("31 October – 13 November 2026") has no time to show.
				const [first, ...details] = decode(decode(event[3])).split(' | ');
				if (details.some((d) => /\d{4}/.test(d) && /[–-]/.test(d))) continue;
				let start = midnight + later + minutes * 60_000;
				for (const detail of details) {
					const on = /^(\d{1,2}) ([a-z]{3})[a-z]* (\d{4})$/i.exec(detail.trim());
					if (on) start = Date.UTC(Number(on[3]), MONTHS.indexOf(on[2].toLowerCase()), Number(on[1])) + minutes * 60_000;
				}
				// "NBA : Charlotte Hornets vs Miami Heat": the league, then the game.
				const named = tidy(first);
				const split = named.indexOf(' : ');
				const league = split > 0 ? named.slice(0, split).trim() : category;
				const title = split > 0 ? named.slice(split + 3).trim() : named;
				if (!title) continue;
				const general = /^(ppv|upcoming|all )/i.test(category);
				// The schedule's "TV Shows 📺" (Jeopardy!, Family Feud, late-night shows), and a show
				// marked 📺 elsewhere ("📺🇺🇸 Saturday Night Live" under Upcoming Events), are shows, not
				// games — even "🏈 Monday Night Countdown", a show about football.
				const show = /^tv shows?\b/i.test(category) || /📺/u.test(first);
				const sport: Sport = show ? 'tv' : ((general ? null : sportOf(category)) ?? sportOf(`${first} ${category}`) ?? 'other');
				const id = createHash('sha1').update(`${start}|${title.toLowerCase()}`).digest('hex').slice(0, 12);
				const known = byId.get(id);
				if (known) {
					for (const channel of channels) if (!known.channels.some((c) => c.id === channel.id)) known.channels.push(channel);
				} else byId.set(id, { id, sport, league: show || (general && split < 0) ? '' : league, title, start, channels });
			}
		}
	}
	const games = [...byId.values()].sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
	// Two channels of one name for a game ("Apple TV", "Apple TV"): "Apple TV 2" for the second.
	for (const game of games) {
		const seen = new Map<string, number>();
		for (const channel of game.channels) {
			const count = (seen.get(channel.name) ?? 0) + 1;
			seen.set(channel.name, count);
			if (count > 1) channel.name = `${channel.name} ${count}`;
		}
	}
	return games;
}

const AMERICAN = /mlb|nba|wnba|nhl|nfl|ncaa|college|\bmls\b|major league|nwsl|\busl\b|\baew\b|\bwwe\b|\bufc\b|\bcfl\b|liga mx/i;

/** Without flags (Windows shows them as letters), sport pictures, or doubled spaces. */
const tidy = (text: string) =>
	decode(decode(text))
		.replace(/[\u{1F1E6}-\u{1F1FF}\u{E0000}-\u{E007F}]/gu, '')
		.replace(/[\p{Extended_Pictographic}️‍]/gu, '')
		.replace(/\s+/g, ' ')
		.trim();

const decode = (text: string) =>
	text.replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

type Link = { url: string; headers: Record<string, string>; until: number };
const links = new Map<number, Link>();
const asking = new Map<number, Promise<Link | null>>();
/** Asked for again this long before its token runs out. */
const MARGIN_MS = 40_000;

/**
 * A channel's playlist address and headers, fresh enough to use (`fresh`: asked for anew, after
 * the one kept stopped working). While the one kept is still good it's used straight away, and
 * the next is asked for in the background once it's close to running out. Null when it can't be
 * had (not in the desktop app, or the channel isn't on).
 */
export async function liveLink(id: number, fresh = false): Promise<Link | null> {
	const kept = links.get(id);
	const left = kept ? kept.until - Date.now() : 0;
	if (kept && !fresh && left > 5_000) {
		if (left < MARGIN_MS) void ask(id);
		return kept;
	}
	return (await ask(id)) ?? (kept && kept.until > Date.now() ? kept : null);
}

/**
 * The channel's page comes from one of several player servers (the site's "Player 1, 2…"
 * buttons); when one doesn't play the channel, the next is used for it from then on.
 */
const PLAYERS = ['stream', 'cast', 'player', 'watch', 'plus', 'casting', 'hub'];
const playerFor = new Map<number, number>();

/** The channel's playlist didn't work on its current player server: the next one, next time. */
export function liveTrouble(id: number) {
	playerFor.set(id, ((playerFor.get(id) ?? 0) + 1) % PLAYERS.length);
	links.delete(id);
}

/** The desktop app reads the channel's page for its playlist (one look at a time per channel). */
function ask(id: number): Promise<Link | null> {
	const already = asking.get(id);
	if (already) return already;
	const page = `${site}/${PLAYERS[playerFor.get(id) ?? 0]}/stream-${id}.php`;
	const look = electronLiveCapture(page, `${site}/watch.php?id=${id}`)
		.then((found) => {
			if (!found?.url) {
				liveTrouble(id);
				return null;
			}
			// "?t=<seconds>.<signature>": when the token runs out (two minutes if it doesn't say).
			const expires = Number(/[?&]t=(\d+)/.exec(found.url)?.[1]) * 1000;
			const link = { url: found.url, headers: { 'User-Agent': UA, ...found.headers }, until: expires > Date.now() ? expires : Date.now() + 120_000 };
			links.set(id, link);
			return link;
		})
		.finally(() => asking.delete(id));
	asking.set(id, look);
	return look;
}
