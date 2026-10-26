/**
 * Pictures for Live TV's games: both teams' logos and colors, from ESPN's public team lists
 * (no key; site.api.espn.com/apis/site/v2/sports/<sport>/<league>/teams). The owner's dad can't
 * read the small print without glasses, and a wall of grey boxes was "boring" (2026-10-25).
 *
 * A game's league (as DaddyLive names it) picks the list; the title's two sides ("A vs B") are
 * matched to its teams by name. College games of any sport use the schools' list (the same
 * schools play volleyball and soccer). Each list is kept a week, in the library too. A game
 * whose teams aren't found has no `art`, and the pages show its sport's picture instead.
 */
import { getOrderCache, saveOrderCache } from './db/queries';
import { withShowPictures } from './showArt';
import type { GameArt, LiveGame, TeamArt } from '$lib/live';

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** DaddyLive's league names → ESPN's list. The first match wins. */
const LEAGUES: [RegExp, string][] = [
	[/^nfl\b/i, 'football/nfl'],
	[/college football|ncaaf|ncaa football/i, 'football/college-football'],
	[/^nba\b/i, 'basketball/nba'],
	[/^wnba\b/i, 'basketball/wnba'],
	[/women'?s college basketball|ncaaw/i, 'basketball/womens-college-basketball'],
	[/college basketball|ncaab|ncaa basketball/i, 'basketball/mens-college-basketball'],
	[/women'?s college soccer/i, 'soccer/usa.ncaa.w.1'],
	[/college/i, 'basketball/mens-college-basketball|football/college-football'],
	[/^nhl\b/i, 'hockey/nhl'],
	[/^mlb\b/i, 'baseball/mlb'],
	[/women'?s super league|\bwsl\b/i, 'soccer/eng.w.1'],
	[/premier league/i, 'soccer/eng.1'],
	[/championship/i, 'soccer/eng.2'],
	[/la ?liga|spain.*primera/i, 'soccer/esp.1'],
	[/segunda/i, 'soccer/esp.2'],
	[/serie a$|italy.*serie a/i, 'soccer/ita.1'],
	[/bundesliga/i, 'soccer/ger.1'],
	[/ligue 1/i, 'soccer/fra.1'],
	[/portugal.*primeira|primeira liga/i, 'soccer/por.1'],
	[/eredivisie/i, 'soccer/ned.1'],
	[/belgi/i, 'soccer/bel.1'],
	[/greece|greek/i, 'soccer/gre.1'],
	[/denmark|superliga/i, 'soccer/den.1'],
	[/liga mx|mexico/i, 'soccer/mex.1'],
	[/argentin/i, 'soccer/arg.1'],
	[/colombia/i, 'soccer/col.1'],
	[/chile/i, 'soccer/chi.1'],
	[/peru/i, 'soccer/per.1'],
	[/nwsl/i, 'soccer/usa.nwsl'],
	[/\bmls\b|major league soccer/i, 'soccer/usa.1'],
	[/brasil|brazil|brasileir/i, 'soccer/bra.1'],
	[/scotland|scottish/i, 'soccer/sco.1'],
	[/turk|süper lig|super lig/i, 'soccer/tur.1'],
	[/champions league/i, 'soccer/uefa.champions'],
	[/conference league/i, 'soccer/uefa.europa.conf'],
	[/europa league/i, 'soccer/uefa.europa'],
	[/romania/i, 'soccer/rou.1'],
	[/cyprus/i, 'soccer/cyp.1'],
	[/austria/i, 'soccer/aut.1'],
	[/switzerland|swiss/i, 'soccer/sui.1'],
	[/saudi/i, 'soccer/ksa.1'],
	[/norway|eliteserien/i, 'soccer/nor.1'],
	[/israel.*(ligat|premier)/i, 'soccer/isr.1'],
	[/costa rica/i, 'soccer/crc.1']
];

/** Words in many clubs' names, never a team on their own ("Sporting" Braga isn't Sporting CP). */
const COMMON_WORDS = new Set(
	'sporting real united city state athletic atletico deportivo inter racing union olympique saint san santa new los las st universidad hapoel maccabi dynamo dinamo red blue royal'.split(' ')
);
const allCommon = (name: string) => name.split(' ').every((word) => COMMON_WORDS.has(word));

type Team = { names: string[]; nick: string; art: TeamArt };
const lists = new Map<string, Promise<Team[]>>();

/** Lowercase, no accents, no "FC"/"CF"-style words or punctuation: "Sporting Braga" ~ "SC Braga". */
function plain(name: string): string {
	return name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9& ]+/g, ' ')
		.replace(/\b(fc|cf|sc|afc|ac|cd|ud|ss|as|fk|sk|bc|club|de|the)\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

async function teamsOf(path: string): Promise<Team[]> {
	const key = `espn-teams3:${path}`;
	const kept = getOrderCache(key);
	if (kept && Date.now() - kept.at < WEEK) return kept.value as Team[];
	try {
		const resp = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams?limit=1000`, { signal: AbortSignal.timeout(10_000) });
		if (!resp.ok) throw new Error();
		type Espn = {
			team: {
				displayName?: string;
				shortDisplayName?: string;
				name?: string;
				location?: string;
				nickname?: string;
				abbreviation?: string;
				color?: string;
				logos?: { href: string; rel: string[] }[];
			};
		};
		const raw = ((await resp.json())?.sports?.[0]?.leagues?.[0]?.teams ?? []) as Espn[];
		const teams: Team[] = [];
		for (const { team } of raw) {
			const logos = team.logos ?? [];
			const logo = (logos.find((l) => l.rel.includes('dark') && !l.rel.includes('scoreboard')) ?? logos.find((l) => l.rel.includes('default')))?.href;
			if (!logo || !team.displayName) continue;
			const names = [team.displayName, team.shortDisplayName, team.name, team.location, team.nickname, team.location && team.name ? `${team.location} ${team.name}` : '']
				.filter((n): n is string => Boolean(n))
				.map(plain)
				.filter((n) => n.length >= 3 && !allCommon(n));
			// The short form ("PSG", "AZ") only ever as the whole side.
			if (team.abbreviation) names.push(`=${team.abbreviation.toLowerCase()}`);
			// The nickname ("Clippers"): it settles a city two teams share ("LA Clippers" vs the Lakers).
			const nick = team.name && team.name !== team.location ? plain(team.name) : '';
			teams.push({ names: [...new Set(names)], nick: nick.length >= 4 && !allCommon(nick) ? nick : '', art: { name: team.displayName, logo, color: `#${(team.color || '444444').replace('#', '')}` } });
		}
		if (teams.length) saveOrderCache(key, teams, Date.now());
		return teams;
	} catch {
		return (kept?.value as Team[] | undefined) ?? [];
	}
}

function listFor(path: string): Promise<Team[]> {
	let list = lists.get(path);
	if (!list) {
		list = teamsOf(path);
		lists.set(path, list);
		// Asked again after a day (or after a minute if it came back empty).
		list.then((teams) => setTimeout(() => lists.delete(path), teams.length ? 24 * 60 * 60 * 1000 : 60_000));
	}
	return list;
}

/** The team a side of the title names: the same name, else the longest of its names inside it (or it inside one). */
function findTeam(side: string, teams: Team[]): TeamArt | null {
	const wanted = plain(side.replace(/\b(w|women|u\d{2})\b/gi, ''));
	if (wanted.length < 2) return null;
	const exact = teams.filter((t) => t.names.includes(wanted) || t.names.includes(`=${wanted}`));
	if (exact.length === 1) return exact[0].art;
	const byNick = teams.filter((t) => t.nick && ` ${wanted} `.includes(` ${t.nick} `));
	if (byNick.length === 1) return byNick[0].art;
	let best: TeamArt | null = null;
	let bestLength = 0;
	let tie = false;
	for (const team of teams) {
		for (const name of team.names) {
			if (name.length < 4 || name.startsWith('=')) continue;
			const inside = ` ${wanted} `.includes(` ${name} `) || ` ${name} `.includes(` ${wanted} `);
			if (!inside) continue;
			if (name.length > bestLength) {
				best = team.art;
				bestLength = name.length;
				tie = false;
			} else if (name.length === bestLength && best !== team.art) tie = true;
		}
	}
	return tie ? null : best;
}

/** A game's two teams, if its league has a list and both sides are found in it. */
async function artOf(game: LiveGame): Promise<GameArt | null> {
	const paths = LEAGUES.find(([pattern]) => pattern.test(game.league))?.[1];
	if (!paths) return null;
	const sides = game.title.replace(/^[^:]*:\s*/, '').split(/\s+(?:vs\.?|v|@)\s+/i);
	if (sides.length !== 2) return null;
	// (College games: the basketball schools first, every Division I school; then football's.)
	for (const path of paths.split('|')) {
		const teams = await listFor(path);
		const a = findTeam(sides[0], teams);
		const b = findTeam(sides[1], teams);
		if (a && b && a.logo !== b.logo) return { teams: [a, b], league: path };
	}
	return null;
}

/**
 * The games (and TV shows) with their pictures added where found. Waits at most `waitMs` for lists not yet
 * known (the first time a league comes up), so Live TV isn't held up; the next ask has them.
 */
export async function withArt(games: LiveGame[], waitMs = 4000): Promise<LiveGame[]> {
	const found = Promise.all(games.map((g) => (g.sport === 'tv' ? null : artOf(g).catch(() => null))));
	const [arts, withShows] = await Promise.all([
		Promise.race([found, new Promise<null>((r) => setTimeout(() => r(null), waitMs))]),
		// TV shows have no teams: their own pictures (showArt.ts).
		withShowPictures(games, waitMs)
	]);
	return withShows.map((g, i) => (arts?.[i] ? { ...g, art: arts[i]! } : g));
}
