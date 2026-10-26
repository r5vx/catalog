/**
 * Which games are shown in the viewer's country (Where to watch): the owner, set to the USA, saw
 * Colombian soccer and Israeli basketball all over Live TV (2026-10-25). A game counts as local
 * when one of its channels is from that country (ESPN USA, CBS USA…), or its league is one of the
 * country's own (the NFL's games are mostly on "Event stream" and "NFL Sunday Ticket", which say
 * no country). Live TV shows only local games unless "Other countries" is on, or it's a search.
 * On a Sunday in October: 40 of 133 games for the USA, the NBA/NHL/NFL/MLB/MLS and college games
 * plus the Liga MX, La Liga and Turkish matches on American channels.
 */
import type { LiveChannel, LiveGame } from '$lib/live';

/** Each country's own leagues and events, by name (as DaddyLive writes them). */
const OWN_LEAGUES: Record<string, RegExp> = {
	USA: /\b(nfl|nba|wnba|nhl|mlb|mls|nwsl|ncaa|college|nascar|indycar|pga|lpga|ufc|wwe|aew|usl|united states|major league)\b/i,
	UK: /\b(premier league|championship|efl|fa cup|carabao|scottish|wsl|super league|six nations|premiership|county championship|the hundred|bdo|pdc)\b/i,
	Canada: /\b(cfl|nhl|mls|canadian|ohl|whl|qmjhl|u sports)\b/i,
	Australia: /\b(afl|nrl|a-league|big bash|sheffield shield|super netball|nbl)\b/i,
	Ireland: /\b(gaa|hurling|league of ireland|urc|united rugby)\b/i
};

/** The games marked `local` (shown in `home`, a country name like "USA"); none marked without one. */
export function withLocal(games: LiveGame[], channels: LiveChannel[], home: string): LiveGame[] {
	if (!home) return games;
	const country = new Map(channels.map((c) => [c.id, c.country]));
	const own = OWN_LEAGUES[home];
	return games.map((game) => ({
		...game,
		local: game.channels.some((c) => country.get(c.id) === home) || Boolean(own && (own.test(game.league) || own.test(game.title)))
	}));
}
