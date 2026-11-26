/**
 * Catasong's daily song: one song a day for each genre. It's heard for 0.1 s, then 0.5, 2, 8 and
 * 16 s after each miss or skip. A guess of the right artist but the wrong song shows yellow.
 *
 * Songs come from Deezer's public API (no key): a Deezer genre's chart (200 songs), or for
 * genres Deezer doesn't list (Phonk, K-Pop, or anything typed in), the songs of the first two
 * public playlists its search finds by that name. Every song has a 30 s preview (MP3).
 * The day's song is picked once and kept (`catasong-day1|<date>|<genre>`), and isn't picked
 * again for 120 days of that genre. Preview links expire, so they're asked for fresh each time
 * and passed on by /api/catasong/audio (the page never sees which song it is).
 *
 * Today's guesses (setting catasongToday) and each genre's days played, won and streak
 * (catasongStats) are kept on this computer, so a reload or another device keeps the game.
 */
import { randomBytes } from 'node:crypto';
import { getOrderCache, saveOrderCache } from '../db/queries';
import { readSettings, updateSettings } from '../settings';

const DEEZER = 'https://api.deezer.com';
export const STEPS = [0.1, 0.5, 2, 8, 16];

/** Deezer's own genres, by Catasong's key. */
const CHART_GENRES: Record<string, { id: number; label: string }> = {
	rap: { id: 116, label: 'Rap' },
	rock: { id: 152, label: 'Rock' },
	all: { id: 0, label: 'All' },
	pop: { id: 132, label: 'Pop' },
	rnb: { id: 165, label: 'R&B' },
	dance: { id: 113, label: 'Dance' },
	electro: { id: 106, label: 'Electro' },
	alternative: { id: 85, label: 'Alternative' },
	metal: { id: 464, label: 'Metal' },
	country: { id: 84, label: 'Country' },
	latin: { id: 197, label: 'Latin' },
	reggaeton: { id: 122, label: 'Reggaeton' },
	soul: { id: 169, label: 'Soul & Funk' },
	jazz: { id: 129, label: 'Jazz' },
	blues: { id: 153, label: 'Blues' },
	folk: { id: 466, label: 'Folk' },
	reggae: { id: 144, label: 'Reggae' },
	classical: { id: 98, label: 'Classical' },
	films: { id: 173, label: 'Films & Games' },
	african: { id: 2, label: 'African' },
	asian: { id: 16, label: 'Asian' },
	brazilian: { id: 75, label: 'Brazilian' },
	indian: { id: 81, label: 'Indian' },
	christian: { id: 186, label: 'Christian' }
};

/** Genres found by playlist search, by key → what's searched. */
const SEARCH_GENRES: Record<string, string> = {
	phonk: 'Phonk',
	kpop: 'K-Pop',
	drill: 'Drill',
	trap: 'Trap',
	edm: 'EDM',
	lofi: 'Lo-fi',
	emo: 'Emo',
	punk: 'Punk',
	grunge: 'Grunge',
	hyperpop: 'Hyperpop',
	disco: 'Disco',
	anime: 'Anime songs',
	'80s': '80s hits',
	'90s': '90s hits',
	'2000s': '2000s hits',
	'2010s': '2010s hits'
};

export const MAIN_GENRES = ['rap', 'rock', 'all'];

/** Every genre for the menu, main three first. */
export function genreList(): { key: string; label: string }[] {
	const searchedLabel = (key: string) => (key.endsWith('s') && /^\d/.test(key) ? key : SEARCH_GENRES[key].replace(/ songs$/, ''));
	return [
		...Object.entries(CHART_GENRES).map(([key, g]) => ({ key, label: g.label })),
		...Object.keys(SEARCH_GENRES).map((key) => ({ key, label: searchedLabel(key) }))
	];
}

/** A typed-in genre's key: "q:" and the words, lower case. */
const typedGenre = (key: string) => (key.startsWith('q:') ? key.slice(2) : null);

export function isGenre(key: unknown): key is string {
	if (typeof key !== 'string') return false;
	if (key in CHART_GENRES || key in SEARCH_GENRES) return true;
	const typed = typedGenre(key);
	return typed !== null && /^[a-z0-9 &'+-]{2,30}$/.test(typed) && typed.trim() === typed;
}

export function genreLabel(key: string): string {
	const typed = typedGenre(key);
	if (typed) return typed.replace(/\b\w/g, (letter) => letter.toUpperCase());
	return genreList().find((g) => g.key === key)?.label ?? key;
}

/** What a typed genre's key is (lower case, single spaces), or null when it can't be one. */
export function keyForTyped(text: string): string | null {
	const key = `q:${text.toLowerCase().replace(/\s+/g, ' ').trim()}`;
	const known = genreList().find((g) => `q:${g.label.toLowerCase()}` === key);
	if (known) return known.key;
	return isGenre(key) ? key : null;
}

/* ------------------------------------------------------------------ songs */

export type Song = { id: number; title: string; artist: string; artistId: number; cover: string | null; album: string | null };

type DeezerTrack = {
	id: number;
	title: string;
	readable?: boolean;
	preview?: string;
	/** Deezer's popularity: how much it's played. */
	rank?: number;
	artist: { id: number; name: string };
	album?: { title?: string; cover_medium?: string };
};

async function deezer<T>(path: string): Promise<T | null> {
	try {
		const response = await fetch(DEEZER + path, { signal: AbortSignal.timeout(10_000) });
		if (!response.ok) return null;
		const payload = (await response.json()) as T & { error?: unknown };
		return payload.error ? null : payload;
	} catch {
		return null;
	}
}

const toSong = (t: DeezerTrack): Song => ({
	id: t.id,
	title: t.title,
	artist: t.artist.name,
	artistId: t.artist.id,
	cover: t.album?.cover_medium ?? null,
	album: t.album?.title ?? null
});

const POOL_KEEP = 3 * 24 * 60 * 60 * 1000;
/** How many of a genre's songs a day's song is picked from: the most played on Deezer. */
const POOL_SIZE = 120;

/** How many songs Endless picks from: the daily list's kind of songs, more of them. */
const WIDE_SIZE = 400;

/**
 * A genre's songs to pick from (kept 3 days), or [] when Deezer couldn't be asked. The daily
 * song comes from the 120 most played; Endless (`wide`) from the 400 most played of the chart
 * plus the genre's biggest playlists, so it doesn't run out.
 */
async function poolFor(key: string, wide = false): Promise<Song[]> {
	const cacheKey = `${wide ? 'catasong-wide1' : 'catasong-pool2'}|${key}`;
	const kept = getOrderCache(cacheKey);
	if (kept && Date.now() - kept.at < POOL_KEEP && (kept.value as Song[]).length) return kept.value as Song[];

	let tracks: DeezerTrack[] = [];
	const chart = CHART_GENRES[key];
	if (chart) tracks = (await deezer<{ data: DeezerTrack[] }>(`/chart/${chart.id}/tracks?limit=200`))?.data ?? [];
	if (!chart || wide) {
		const words = SEARCH_GENRES[key] ?? typedGenre(key) ?? (chart ? `${chart.label} hits` : key);
		const found = await deezer<{ data: { id: number; nb_tracks: number }[] }>(`/search/playlist?q=${encodeURIComponent(words)}&limit=15`);
		const lists = (found?.data ?? []).filter((p) => p.nb_tracks >= 30 && p.nb_tracks <= 3000).slice(0, wide ? 3 : 2);
		for (const list of lists) {
			tracks.push(...((await deezer<{ data: DeezerTrack[] }>(`/playlist/${list.id}/tracks?limit=300`))?.data ?? []));
		}
	}
	// Only the best known: a chart's lower half is lo-fi instrumentals nobody could name.
	const seen = new Set<number>();
	const songs = tracks
		.filter((t) => t.readable !== false && t.preview && !seen.has(t.id) && seen.add(t.id))
		.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
		.slice(0, wide ? WIDE_SIZE : POOL_SIZE)
		.map(toSong);
	if (songs.length) saveOrderCache(cacheKey, songs, Date.now());
	return songs.length ? songs : ((kept?.value as Song[]) ?? []);
}

/**
 * The day in New York, YYYY-MM-DD: new songs come at midnight Eastern for everyone (owner,
 * 2026-11-26: "it should happen at 12am est"), not at each computer's own midnight.
 */
const RESET_ZONE = 'America/New_York';
export const today = (when = new Date()) => when.toLocaleDateString('en-CA', { timeZone: RESET_ZONE });
const yesterday = () => today(new Date(Date.now() - 24 * 60 * 60 * 1000));

/** A number from text, so a day and genre always pick the same song. */
function seed(text: string): number {
	let hash = 0x811c9dc5;
	for (const letter of text) {
		hash ^= letter.codePointAt(0)!;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}

const picking = new Map<string, Promise<Song | null>>();

/** Today's song for a genre, picked once and kept. */
export function songOfTheDay(key: string): Promise<Song | null> {
	const date = today();
	const dayKey = `catasong-day1|${date}|${key}`;
	const kept = getOrderCache(dayKey);
	if (kept) return Promise.resolve(kept.value as Song);
	const already = picking.get(dayKey);
	if (already) return already;
	const work = (async () => {
		const pool = await poolFor(key);
		if (!pool.length) return null;
		const recentKey = `catasong-recent1|${key}`;
		const recent = (getOrderCache(recentKey)?.value as number[] | undefined) ?? [];
		const fresh = pool.filter((s) => !recent.includes(s.id));
		const choices = fresh.length ? fresh : pool;
		const song = choices[seed(`${date}|${key}`) % choices.length];
		saveOrderCache(dayKey, song, Date.now());
		saveOrderCache(recentKey, [...recent, song.id].slice(-120), Date.now());
		return song;
	})().finally(() => picking.delete(dayKey));
	picking.set(dayKey, work);
	return work;
}

const previews = new Map<number, { url: string; at: number }>();

/** A fresh preview address for today's song of a genre (Deezer's links stop working after a while). */
export async function previewOf(key: string): Promise<string | null> {
	const song = await songOfTheDay(key);
	if (!song) return null;
	const kept = previews.get(song.id);
	if (kept && Date.now() - kept.at < 10 * 60 * 1000) return kept.url;
	const track = await deezer<DeezerTrack>(`/track/${song.id}`);
	if (!track?.preview) return null;
	previews.set(song.id, { url: track.preview, at: Date.now() });
	return track.preview;
}

/** Songs for the guess box. */
export async function searchSongs(query: string): Promise<{ id: number; title: string; artist: string; artistId: number }[]> {
	if (query.trim().length < 2) return [];
	const found = await deezer<{ data: DeezerTrack[] }>(`/search?q=${encodeURIComponent(query.trim())}&limit=15`);
	// Deezer lists one song more than once (and the same name on an album and a single): once each.
	const seen = new Set<string>();
	return (found?.data ?? [])
		.filter((t) => {
			const key = `${plainTitle(t.title)}|${t.artist.id}`;
			return !seen.has(key) && seen.add(key);
		})
		.slice(0, 8)
		.map((t) => ({ id: t.id, title: t.title, artist: t.artist.name, artistId: t.artist.id }));
}

/** Album covers for the page's background: the genre's, never today's song's own (it'd give it away). */
export async function coversFor(key: string): Promise<string[]> {
	const [pool, song] = await Promise.all([poolFor(key), songOfTheDay(key)]);
	const covers = [...new Set(pool.filter((s) => s.cover && s.album !== song?.album).map((s) => s.cover!))];
	for (let i = covers.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[covers[i], covers[j]] = [covers[j], covers[i]];
	}
	return covers.slice(0, 40);
}

/** Picks today's songs for the main genres in the background, so changing genre doesn't wait. */
export function warmMain() {
	for (const key of MAIN_GENRES) {
		void songOfTheDay(key).catch(() => null);
		// Endless's bigger list too (four Deezer asks per genre, kept 3 days).
		void poolFor(key, true).catch(() => null);
	}
}

export function volume(): number {
	const kept = Number(readSettings().catasongVolume);
	return Number.isFinite(kept) && readSettings().catasongVolume ? Math.min(1, Math.max(0, kept)) : 0.4;
}

export function setVolume(value: number) {
	updateSettings({ catasongVolume: String(Math.min(1, Math.max(0, value))) });
}

/* ------------------------------------------------------------------ guesses */

export type Try = { text: string; verdict: 'wrong' | 'artist' | 'skip' };
export type Play = { tries: Try[]; done: boolean; won: boolean };
type Today = { date: string; plays: Record<string, Play> };
export type Stats = { played: number; won: number; streak: number; best: number; last: string | null };

function readToday(): Today {
	try {
		const kept = JSON.parse(readSettings().catasongToday ?? '') as Today;
		if (kept.date === today()) return kept;
	} catch {
		/* none yet */
	}
	return { date: today(), plays: {} };
}

function readStats(): Record<string, Stats> {
	try {
		return JSON.parse(readSettings().catasongStats ?? '{}');
	} catch {
		return {};
	}
}

const emptyStats: Stats = { played: 0, won: 0, streak: 0, best: 0, last: null };

/** A name without what versions add: "(feat. …)", "(Remastered 2011)", "- Live", "(Slowed)". */
const plainTitle = (title: string) =>
	title
		.toLowerCase()
		.replace(/\s*[([].*?[)\]]/g, '')
		.replace(/\s+-\s+.*$/, '')
		.replace(/\bfeat\..*$/, '')
		.normalize('NFKD')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
const plainName = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');

export type Guess = { id: number; title: string; artist: string; artistId: number } | null;

export type TodayAnswer = {
	genre: string;
	label: string;
	date: string;
	play: Play;
	stats: Stats;
	answer: Song | null;
	msToNext: number;
};

/** How far New York's clock is ahead of UTC at that moment, in ms (negative: behind). */
function zoneOffset(at: number): number {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', { timeZone: RESET_ZONE, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
			.formatToParts(new Date(at))
			.map((p) => [p.type, Number(p.value)])
	);
	return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(at / 1000) * 1000;
}

/** Until the next midnight in New York (right on the days the clocks change, too). */
function msToMidnight(): number {
	const now = Date.now();
	const [y, m, d] = today(new Date(now)).split('-').map(Number);
	const wall = Date.UTC(y, m - 1, d + 1);
	const guess = wall - zoneOffset(now);
	return Math.max(1000, wall - zoneOffset(guess) - now);
}

/** Where today's game of a genre stands; the song itself only once it's over. */
export async function todayOf(key: string): Promise<TodayAnswer | null> {
	const song = await songOfTheDay(key);
	if (!song) return null;
	const play = readToday().plays[key] ?? { tries: [], done: false, won: false };
	return {
		genre: key,
		label: genreLabel(key),
		date: today(),
		play,
		stats: readStats()[key] ?? emptyStats,
		answer: play.done ? song : null,
		msToNext: msToMidnight()
	};
}

/** A guess (null skips). Right: the same song (or the same name by the same artist). Yellow: the right artist. */
export async function guessToday(key: string, guess: Guess): Promise<TodayAnswer | null> {
	const song = await songOfTheDay(key);
	if (!song) return null;
	const state = readToday();
	const play = state.plays[key] ?? { tries: [], done: false, won: false };
	if (!play.done) {
		judge(song, guess, play);
		state.plays[key] = play;
		const patch: Record<string, string> = { catasongToday: JSON.stringify(state) };
		if (play.done) {
			const all = readStats();
			const before = all[key] ?? emptyStats;
			const streak = play.won ? (before.last === yesterday() && before.streak > 0 ? before.streak + 1 : 1) : 0;
			all[key] = {
				played: before.played + 1,
				won: before.won + (play.won ? 1 : 0),
				streak,
				best: Math.max(before.best, streak),
				last: today()
			};
			patch.catasongStats = JSON.stringify(all);
		}
		updateSettings(patch);
	}
	return todayOf(key);
}

/** One guess against a song: right ends the game; wrong, right-artist (yellow) or skipped adds a try. */
function judge(song: Song, guess: Guess, play: Play) {
	const sameArtist = guess !== null && (guess.artistId === song.artistId || plainName(guess.artist) === plainName(song.artist));
	const right = guess !== null && (guess.id === song.id || (sameArtist && plainTitle(guess.title) === plainTitle(song.title)));
	if (right) {
		play.done = true;
		play.won = true;
		return;
	}
	play.tries.push(
		guess === null ? { text: 'Skipped', verdict: 'skip' } : { text: `${guess.title} · ${guess.artist}`, verdict: sameArtist ? 'artist' : 'wrong' }
	);
	if (play.tries.length >= STEPS.length) play.done = true;
}

/* ------------------------------------------------------------------ Endless */

/*
 * Endless: a random song, then another, as long as wanted, from the genre's wide list. Rounds
 * live on the server (the page only has a token); no song again until 60 others of that genre
 * have been played. The streak counts songs got in a row; the best is kept per genre
 * (setting catasongEndlessBest).
 */
type EndlessRound = { key: string; song: Song; play: Play; at: number };
const endlessRounds = new Map<string, EndlessRound>();
const endlessRecent: Record<string, number[]> = {};
const endlessStreak: Record<string, number> = {};

export type EndlessAnswer = { token: string; play: Play; answer: Song | null; streak: number; best: number };

function endlessBest(): Record<string, number> {
	try {
		return JSON.parse(readSettings().catasongEndlessBest ?? '{}');
	} catch {
		return {};
	}
}

function endlessAnswer(token: string, round: EndlessRound): EndlessAnswer {
	return {
		token,
		play: round.play,
		answer: round.play.done ? round.song : null,
		streak: endlessStreak[round.key] ?? 0,
		best: endlessBest()[round.key] ?? 0
	};
}

export async function newEndless(key: string): Promise<EndlessAnswer | null> {
	const pool = await poolFor(key, true);
	if (!pool.length) return null;
	const recent = (endlessRecent[key] ??= []);
	const fresh = pool.filter((s) => !recent.includes(s.id));
	const choices = fresh.length ? fresh : pool;
	const song = choices[Math.floor(Math.random() * choices.length)];
	recent.push(song.id);
	while (recent.length > Math.min(60, Math.floor(pool.length / 2))) recent.shift();
	for (const [old, round] of endlessRounds) if (Date.now() - round.at > 6 * 60 * 60 * 1000) endlessRounds.delete(old);
	const token = randomBytes(9).toString('base64url');
	const round: EndlessRound = { key, song, play: { tries: [], done: false, won: false }, at: Date.now() };
	endlessRounds.set(token, round);
	return endlessAnswer(token, round);
}

export function guessEndless(token: string, guess: Guess): EndlessAnswer | null {
	const round = endlessRounds.get(token);
	if (!round) return null;
	if (!round.play.done) {
		judge(round.song, guess, round.play);
		if (round.play.done) {
			const streak = round.play.won ? (endlessStreak[round.key] ?? 0) + 1 : 0;
			endlessStreak[round.key] = streak;
			const best = endlessBest();
			if (streak > (best[round.key] ?? 0)) {
				best[round.key] = streak;
				updateSettings({ catasongEndlessBest: JSON.stringify(best) });
			}
		}
	}
	return endlessAnswer(token, round);
}

/** A fresh preview address for an Endless round's song. */
export async function endlessPreview(token: string): Promise<string | null> {
	const round = endlessRounds.get(token);
	if (!round) return null;
	const kept = previews.get(round.song.id);
	if (kept && Date.now() - kept.at < 10 * 60 * 1000) return kept.url;
	const track = await deezer<DeezerTrack>(`/track/${round.song.id}`);
	if (!track?.preview) return null;
	previews.set(round.song.id, { url: track.preview, at: Date.now() });
	return track.preview;
}
