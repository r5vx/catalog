/**
 * One click to watch a game (the owner's pick of ideas, 2026-10-25): which of its channels to
 * play. Learned from what played here: a channel that played a minute counts for the game's
 * league (and its sport), one that wouldn't play, or was left within a minute, counts against.
 * Until there's any of that: Where to watch's country first, then the English-speaking ones,
 * then the rest, in the schedule's order. Kept for this computer (every profile watches the
 * same channels), in the library.
 */
import { getOrderCache, saveOrderCache } from './db/queries';
import type { LiveChannel, LiveGame } from '$lib/live';

const KEY = 'live-channel-picks';
type Tally = { ok: number; bad: number };
type Picks = Record<string, Record<string, Tally>>;

const ENGLISH = new Set(['USA', 'UK', 'Canada', 'Ireland', 'Australia', 'New Zealand']);

/**
 * The league's own game feeds: when the schedule lists one for a game, it shows that game, start
 * to end. A network channel like "CBS USA" is one city's station: it shows the game only if that
 * city gets it, and its own programs after (the Chargers–Texans game ran past 7 pm on the East
 * Coast; CBS USA was showing ads and 60 Minutes while Sunday Ticket had the 4th quarter,
 * 2026-11-08). These have no country, so the country rule used to put CBS USA first.
 */
const GAME_FEED = /sunday ticket|league pass|nhl gamecenter/i;

function picks(): Picks {
	return (getOrderCache(KEY)?.value as Picks | undefined) ?? {};
}

/** A channel played well (`ok`) or didn't, for a game of `league` in `sport`. */
export function noteChannelPlayed(league: string, sport: string, channel: number, ok: boolean): void {
	const all = picks();
	for (const key of [league ? `league:${league}` : '', sport ? `sport:${sport}` : ''].filter(Boolean)) {
		const tally = ((all[key] ??= {})[String(channel)] ??= { ok: 0, bad: 0 });
		if (ok) tally.ok++;
		else tally.bad++;
	}
	saveOrderCache(KEY, all, Date.now());
}

/** The channel to play each game on (`best`), given the channels' countries and Where to watch's. */
export function withBestChannels(games: LiveGame[], channels: LiveChannel[], home: string): LiveGame[] {
	const all = picks();
	const country = new Map(channels.map((c) => [c.id, c.country]));
	return games.map((game) => {
		if (!game.channels.length) return game;
		const league = all[`league:${game.league}`] ?? {};
		const sport = all[`sport:${game.sport}`] ?? {};
		const score = (id: number) => {
			const here = league[String(id)];
			const anyGame = sport[String(id)];
			let s = 0;
			if (here) s += here.ok * 3 - here.bad * 4;
			if (anyGame) s += (anyGame.ok - anyGame.bad) * 0.5;
			const from = country.get(id) ?? '';
			if (from && from === home) s += 2;
			else if (ENGLISH.has(from)) s += 1;
			else if (from) s -= 1;
			return s;
		};
		// The game's own feeds come first, unless they've failed here more often than they've played.
		const feeds = game.channels.filter((c) => {
			const here = league[String(c.id)];
			return GAME_FEED.test(c.name) && (!here || here.ok >= here.bad);
		});
		const choices = feeds.length ? feeds : game.channels;
		let best = choices[0].id;
		let bestScore = score(best);
		for (const channel of choices.slice(1)) {
			const s = score(channel.id);
			if (s > bestScore) {
				best = channel.id;
				bestScore = s;
			}
		}
		return { ...game, best };
	});
}
