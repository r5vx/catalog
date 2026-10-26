/**
 * Live scores for Live TV's games (the owner's pick of ideas, 2026-10-25), from ESPN's public
 * scoreboards (site.api.espn.com/apis/site/v2/sports/<sport>/<league>/scoreboard, no key) — the
 * same leagues the team pictures come from (teamArt.ts). A game is matched to ESPN's by its two
 * teams' names as the picture found them. Each scoreboard is kept 45 s.
 *
 * Besides the score, ESPN's state settles "On now": a game that's over leaves it on time, and one
 * in overtime stays (isOnNow in src/lib/live.ts).
 */
import type { GameScore, LiveGame } from '$lib/live';

const KEEP_MS = 45_000;

/** Lists that only give a handful of featured games unless asked for a whole division. */
const WHOLE_DIVISION: Record<string, string> = {
	'football/college-football': 'groups=80',
	'basketball/mens-college-basketball': 'groups=50',
	'basketball/womens-college-basketball': 'groups=50'
};

type Board = Map<string, { names: [string, string]; scores: [string, string]; state: GameScore['state']; detail: string }>;
const boards = new Map<string, { at: number; board: Promise<Board>; done?: boolean }>();

const pairKey = (a: string, b: string) => [a, b].sort().join('|');

async function fetchBoard(path: string): Promise<Board> {
	const board: Board = new Map();
	try {
		const extra = WHOLE_DIVISION[path] ? `&${WHOLE_DIVISION[path]}` : '';
		const resp = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?limit=300${extra}`, { signal: AbortSignal.timeout(8000) });
		if (!resp.ok) return board;
		type Espn = {
			competitions?: {
				status?: { type?: { state?: string; shortDetail?: string } };
				competitors?: { team?: { displayName?: string }; score?: string }[];
			}[];
		};
		const events = ((await resp.json())?.events ?? []) as Espn[];
		for (const event of events) {
			const game = event.competitions?.[0];
			const sides = game?.competitors ?? [];
			const state = game?.status?.type?.state;
			if (sides.length !== 2 || (state !== 'pre' && state !== 'in' && state !== 'post')) continue;
			const names = sides.map((s) => s.team?.displayName ?? '') as [string, string];
			if (!names[0] || !names[1]) continue;
			board.set(pairKey(...names), {
				names,
				scores: sides.map((s) => s.score ?? '0') as [string, string],
				state,
				detail: game?.status?.type?.shortDetail ?? ''
			});
		}
	} catch {}
	return board;
}

/** A league's scoreboard: an older one at once while the next is fetched (pages never wait on it). */
function boardFor(path: string): Promise<Board> {
	const kept = boards.get(path);
	if (kept && Date.now() - kept.at < KEEP_MS) return kept.board;
	const board = fetchBoard(path);
	if (kept?.done) {
		board.then((fresh) => boards.set(path, { at: Date.now(), board: Promise.resolve(fresh), done: true }));
		kept.at = Date.now();
		return kept.board;
	}
	const entry: { at: number; board: Promise<Board>; done?: boolean } = { at: Date.now(), board };
	board.then(() => (entry.done = true));
	boards.set(path, entry);
	return board;
}

/**
 * The games with their scores, for those with team pictures that started in the last day (one
 * scoreboard per league asked at most every 45 s). Waits at most `waitMs`.
 */
export async function withScores(games: LiveGame[], waitMs = 3000): Promise<LiveGame[]> {
	const now = Date.now();
	const wanted = games.filter((g) => g.art?.league && g.start <= now + 15 * 60_000 && g.start > now - 24 * 60 * 60_000);
	const leagues = [...new Set(wanted.map((g) => g.art!.league!))];
	const found = Promise.all(leagues.map(async (path) => [path, await boardFor(path)] as const));
	const answer = await Promise.race([found, new Promise<null>((r) => setTimeout(() => r(null), waitMs))]);
	if (!answer) return games;
	const byLeague = new Map(answer);
	return games.map((game) => {
		if (!wanted.includes(game)) return game;
		const [a, b] = game.art!.teams;
		const entry = byLeague.get(game.art!.league!)?.get(pairKey(a.name, b.name));
		if (!entry) return game;
		const first = entry.names[0] === a.name ? 0 : 1;
		const score: GameScore = { a: entry.scores[first], b: entry.scores[1 - first], state: entry.state, detail: entry.detail };
		return { ...game, score };
	});
}
