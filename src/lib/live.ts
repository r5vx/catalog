/**
 * Live TV's games and channels (sources/daddylive.ts), shared by the computer's page, the TV's,
 * and the player. A game is "on now" from a few minutes before it starts until about when that
 * sport's games end (the schedule only says when they start).
 */

export type Sport =
	| 'soccer'
	| 'football'
	| 'basketball'
	| 'baseball'
	| 'hockey'
	| 'tennis'
	| 'fighting'
	| 'motorsport'
	| 'cricket'
	| 'golf'
	| 'rugby'
	| 'tv'
	| 'other';

export type LiveGame = {
	id: string;
	sport: Sport;
	league: string;
	title: string;
	/** When it starts, in milliseconds. */
	start: number;
	channels: { id: number; name: string }[];
	/** The two teams' logos and colors, when they're known (server/teamArt.ts). */
	art?: GameArt;
	/** A TV show's own picture (server/showArt.ts). */
	poster?: string;
	/** The score, in the teams' order, while it's on or just ended (server/liveScores.ts). */
	score?: GameScore;
	/** The channel to play it on with one click (server/liveChannelPicks.ts). */
	best?: number;
	/** Shown in the viewer's country (server/liveLocal.ts); other countries' games are hidden unless asked for. */
	local?: boolean;
};

/** `state`: not started, on, or over; `detail`: ESPN's own words ("11:30 - 4th", "Final", "HT"). */
export type GameScore = { a: string; b: string; state: 'pre' | 'in' | 'post'; detail: string };

/** A game's picture: each team's logo (made for dark backgrounds) and color, first-named first. */
export type GameArt = { teams: [TeamArt, TeamArt]; /** ESPN's league the teams were found in ("football/nfl"). */ league?: string };
export type TeamArt = { name: string; logo: string; color: string };

export type LiveChannel = { id: number; name: string; sports: Sport[]; country: string };

/** Sports in the order they're shown, with how long one of their games usually lasts. */
export const SPORTS: { key: Sport; label: string; hours: number }[] = [
	{ key: 'football', label: 'Football', hours: 3.5 },
	{ key: 'basketball', label: 'Basketball', hours: 2.5 },
	{ key: 'soccer', label: 'Soccer', hours: 2 },
	{ key: 'baseball', label: 'Baseball', hours: 3.25 },
	{ key: 'hockey', label: 'Hockey', hours: 2.75 },
	{ key: 'fighting', label: 'Fighting', hours: 4 },
	{ key: 'motorsport', label: 'Racing', hours: 2.5 },
	{ key: 'tennis', label: 'Tennis', hours: 2.5 },
	{ key: 'golf', label: 'Golf', hours: 6 },
	{ key: 'cricket', label: 'Cricket', hours: 8 },
	{ key: 'rugby', label: 'Rugby', hours: 2 },
	// (The schedule's TV Shows: Jeopardy!, Family Feud, SNL, late-night shows.)
	{ key: 'tv', label: 'TV shows', hours: 1 },
	{ key: 'other', label: 'Other', hours: 2.5 }
];

/** Each sport's color, behind its picture when a game has no team logos (GameArt.svelte, the Roku). */
export const SPORT_COLORS: Record<Sport, string> = {
	football: '#2f5d34',
	basketball: '#a3470d',
	soccer: '#17703d',
	baseball: '#1f3a80',
	hockey: '#0f6475',
	tennis: '#4f7a12',
	fighting: '#8f1d1d',
	motorsport: '#3b4250',
	cricket: '#2b6b3a',
	golf: '#3f6315',
	rugby: '#7a3214',
	tv: '#283a5c',
	other: '#4b2a85'
};

/** Whether to list other countries' games too (Live TV's "Other countries"), on this device. */
const ALL_COUNTRIES = 'catalog:liveAllCountries';
export function allCountriesKept(): boolean {
	try {
		return localStorage.getItem(ALL_COUNTRIES) === '1';
	} catch {
		return false;
	}
}
export function keepAllCountries(on: boolean) {
	try {
		localStorage.setItem(ALL_COUNTRIES, on ? '1' : '0');
	} catch {}
}

/** A photo of the sport (static/sports/), for a game without team logos and the sports picker. */
export const sportPicture = (sport: Sport) => `/sports/${SPORTS.some((s) => s.key === sport) ? sport : 'other'}.jpg`;

export const sportLabel = (sport: Sport) => SPORTS.find((s) => s.key === sport)?.label ?? 'Other';

/** What one of a sport's items is called: a show for TV shows, else a game. */
export const itemWord = (sport: Sport | 'all', count = 1) => (sport === 'tv' ? (count === 1 ? 'show' : 'shows') : count === 1 ? 'game' : 'games');

/** On from this long before the start time (pre-game shows, and clocks that are a little off). */
export const EARLY_MS = 10 * 60 * 1000;

export function gameEnds(game: Pick<LiveGame, 'sport' | 'start'>): number {
	const hours = SPORTS.find((s) => s.key === game.sport)?.hours ?? 2.5;
	return game.start + hours * 60 * 60 * 1000;
}

export const isOnNow = (game: Pick<LiveGame, 'sport' | 'start'> & { score?: GameScore }, now = Date.now()) => {
	// The score knows better than the usual length of a game: over is over, and overtime is on.
	if (game.score?.state === 'post') return false;
	if (game.score?.state === 'in') return true;
	return now >= game.start - EARLY_MS && now < gameEnds(game);
};

/** The score as shown: "24–17" (the teams' order); nothing before it starts. */
export const scoreText = (score: GameScore) => (score.state === 'pre' ? '' : `${score.a}–${score.b}`);

/** "7:30 PM", or "Tomorrow 7:30 PM", or "Sat 7:30 PM" further off; "On now" while it's on. */
export function whenText(game: Pick<LiveGame, 'sport' | 'start'>, now = Date.now()): string {
	if (isOnNow(game, now)) return 'On now';
	const at = new Date(game.start);
	const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	const today = new Date(now);
	const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86_400_000);
	if (days === 0) return time;
	if (days === 1) return `Tomorrow ${time}`;
	return `${at.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

// What a league, game or channel name says about its sport. Checked in order: table tennis
// and field hockey before tennis and hockey, American football before soccer's "football".
const SPORT_TESTS: [Sport, RegExp][] = [
	['other', /table tennis|horse racing|field hockey|floorball|🏓|🏇|🏑/i],
	['football', /am\. football|american football|\bnfl\b|ncaaf|ncaa fbs|ncaa fcs|\bcfl\b|redzone|🏈/i],
	['basketball', /basketball|\bnba\b|wnba|euroleague|\bncaab\b|🏀/i],
	['baseball', /baseball|\bmlb\b|⚾/i],
	['hockey', /hockey|\bnhl\b|\bkhl\b|\bahl\b|\bshl\b|🏒/i],
	['tennis', /tennis|\batp\b|\bwta\b|🎾/i],
	['fighting', /boxing|\bmma\b|\bufc\b|wrestling|\baew\b|\bwwe\b|combat|kickboxing|🥊|🤼|🥋/i],
	['motorsport', /motorsport|motogp|\bf1\b|formula|nascar|indycar|\brally\b|superbike|🏎|🏁|🏍/i],
	['cricket', /cricket|willow|🏏/i],
	['golf', /golf|⛳/i],
	['rugby', /rugby|\bafl\b|aussie rules|🏉/i],
	[
		'soccer',
		/⚽|soccer|football|futbol|fútbol|premiership|premier league|championship|league one|league two|national league|\bmls\b|a-league|nwsl|\busl\b|la ?liga|serie a|bundesliga|ligue 1|eredivisie|copa|uefa|fifa|futsal/i
	]
];

export function sportOf(text: string): Sport | null {
	for (const [sport, test] of SPORT_TESTS) if (test.test(text)) return sport;
	return null;
}

/** Every word typed is somewhere in the text (so "lakers nba" finds "NBA: Lakers vs Suns"). */
export function matches(text: string, search: string): boolean {
	const words = search.toLowerCase().split(/\s+/).filter(Boolean);
	const lower = text.toLowerCase();
	return words.every((word) => lower.includes(word));
}

export const gameText = (game: LiveGame) => `${game.title} ${game.league} ${sportLabel(game.sport)} ${game.channels.map((c) => c.name).join(' ')}`;

/**
 * The player's address for a channel (Catalog's own player, /watch?live=), with the game it's
 * for, so the player can offer its other channels.
 */
export function watchHref(channel: { id: number; name: string }, game?: LiveGame | null): string {
	const params = new URLSearchParams({ live: String(channel.id), name: channel.name });
	if (game) {
		params.set('game', game.id);
		// When it starts: the player waits for a game not on yet (rather than play what's on before it).
		params.set('at', String(game.start));
	}
	return `/watch?${params}`;
}

/** A replay of a past game (sources/replays.ts), as Live TV lists it. */
export type LiveReplay = {
	id: string;
	sport: Sport;
	league: string;
	title: string;
	date: string;
	poster: string | null;
	/** Only a condensed game so far: its minutes. */
	condensed?: number | null;
};

/** A replay's line under its title: sport, league, day, and whether it's only condensed so far. */
export const replayLine = (replay: LiveReplay) =>
	[replay.condensed ? `Condensed, ${replay.condensed} min` : '', sportLabel(replay.sport), replay.league, replayDay(replay.date)].filter(Boolean).join(' · ');

/** A replay this profile watched lately, and how far it got (Live TV's Recently watched). */
export type RecentReplay = { id: string; title: string; poster: string | null; sport: Sport; currentTime: number; duration: number };

/** The player's address for a replay. */
export const replayHref = (replay: Pick<LiveReplay, 'id' | 'title'>) => `/watch?${new URLSearchParams({ replay: replay.id, name: replay.title })}`;

/** "2026-10-24" → "Sat, Oct 24". */
export function replayDay(date: string): string {
	if (!date) return '';
	const at = new Date(`${date}T12:00:00`);
	return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Saves a game or channel to Live TV's Saved (for the profile watching), or takes it off. */
export function sendSaved(what: { kind: 'game'; game: LiveGame } | { kind: 'channel'; id: number; name: string }, saved: boolean) {
	return fetch('/api/live/saved', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...what, saved })
	}).catch(() => null);
}

/** Takes a channel, a replay, or everything off Recently watched. */
export function sendForget(what: { id: number } | { replay: string } | 'all') {
	return fetch('/api/live/watched', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(what === 'all' ? { remove: 'all' } : { ...what, remove: true })
	}).catch(() => null);
}

/**
 * Channels from the viewer's own country first (Where to watch, as the guide's `homeCountry`),
 * then these (the family watches in English), then the rest.
 */
const COUNTRY_ORDER = ['USA', 'UK', 'Canada', 'Ireland', 'Australia', 'New Zealand'];
export const countryRank = (country: string, home = '') => {
	if (home && country === home) return -1;
	const at = COUNTRY_ORDER.indexOf(country);
	return at < 0 ? COUNTRY_ORDER.length : at;
};

/** Which of "On now", "Later today", "Tomorrow" and "Later" a game is in. */
export function timeGroup(game: LiveGame, now = Date.now()): 'On now' | 'Later today' | 'Tomorrow' | 'Later' {
	if (isOnNow(game, now)) return 'On now';
	const day = (at: number) => new Date(at).setHours(0, 0, 0, 0);
	const days = Math.round((day(game.start) - day(now)) / 86_400_000);
	return days <= 0 ? 'Later today' : days === 1 ? 'Tomorrow' : 'Later';
}

/** The channel a game plays on with one click (the guide's `best`), else its first. */
export const bestChannel = (game: LiveGame) => game.channels.find((c) => c.id === game.best) ?? game.channels[0];

/** A game's channels with the one-click one first. */
export const channelsBestFirst = (game: LiveGame) => {
	const best = bestChannel(game);
	return best ? [best, ...game.channels.filter((c) => c.id !== best.id)] : game.channels;
};

/** Whether one of the game's teams is a favorite (by ESPN's name, as the pictures have it). */
export const hasFavorite = (game: LiveGame, favorites: Set<string>) => Boolean(game.art?.teams.some((t) => favorites.has(t.name)));

/** Makes a team a favorite for the profile watching, or not (Live TV puts its games first). */
export function sendTeam(team: TeamArt, saved: boolean) {
	return fetch('/api/live/teams', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ team, saved })
	}).catch(() => null);
}

/** Scores refreshed (every minute while Live TV is open): put into the games that have one. */
export async function freshScores(games: LiveGame[]): Promise<void> {
	const answer = await fetch('/api/live/scores')
		.then((r) => (r.ok ? (r.json() as Promise<{ scores: Record<string, GameScore> }>) : null))
		.catch(() => null);
	if (!answer) return;
	for (const game of games) {
		const score = answer.scores[game.id];
		if (score) game.score = score;
	}
}

/**
 * What Live TV last had in this window, shown at once when it opens again, then refreshed (it
 * showed "Loading" for seconds each time). Replays are asked for as soon as Live TV opens.
 */
export const liveKept: { guide: unknown; replays: LiveReplay[] | null } = { guide: null, replays: null };

/** A replay pointed at (hovered, highlighted on a TV): its video looked up ahead, so it starts sooner. */
const warmed = new Set<string>();
let warming: ReturnType<typeof setTimeout> | undefined;
export function warmReplay(id: string) {
	// Only one pointed at for a moment (passing over the grid doesn't look up every one).
	clearTimeout(warming);
	if (warmed.has(id)) return;
	warming = setTimeout(() => {
		warmed.add(id);
		fetch(`/api/live/replay?${new URLSearchParams({ id })}`).catch(() => {});
	}, 400);
}

export function fetchReplays(): Promise<LiveReplay[]> {
	return fetch('/api/live/replays')
		.then((r) => r.json())
		.then((answer) => (liveKept.replays = (answer.replays ?? []) as LiveReplay[]))
		.catch(() => liveKept.replays ?? []);
}
