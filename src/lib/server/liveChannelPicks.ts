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
		let best = game.channels[0].id;
		let bestScore = score(best);
		for (const channel of game.channels.slice(1)) {
			const s = score(channel.id);
			if (s > bestScore) {
				best = channel.id;
				bestScore = s;
			}
		}
		return { ...game, best };
	});
}
