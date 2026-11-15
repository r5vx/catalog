/**
 * Video games someone voiced, and as whom, for their person page (owner, 2026-11-15: "voice actors
 * of games ... like genshin ... see who they voiced"). TMDB and AniList have no games; Wikidata
 * does, free and with no key: a game's "voice actor" (P725) with the character as its qualifier
 * (P453, or the name alone, P4633), or a character "present in work" (P1441) a game, voiced by
 * them. The person is found by the ids Catalog already has: TMDB person (P4985) or AniList staff
 * (P11227). Genshin Impact: 452 voice actors, each with their character; about half with one of
 * those ids (2026-11-15).
 *
 * The query takes a few seconds (Troy Baker's 28 games: 9 s), so the page asks for it after it
 * shows, and the answer is kept 30 days (a week when there were none).
 */
import { getOrderCache, saveOrderCache } from '../db/queries';

export type GameRole = { title: string; year: number | null; roles: string[]; link: string | null };

const DAY = 24 * 60 * 60 * 1000;
// (A plain name, nothing that says whose Catalog it is.)
const UA = 'Catalog/4 (personal media library)';
const asking = new Map<string, Promise<GameRole[]>>();

/** "tmdb:963818" or "anilist:95054" as Wikidata's property and value; null for anything else. */
function idOf(sourceId: string): { property: string; value: string } | null {
	const m = sourceId.match(/^(tmdb|anilist):(\d+)$/);
	if (!m) return null;
	return { property: m[1] === 'tmdb' ? 'P4985' : 'P11227', value: m[2] };
}

export function gameRoles(sourceId: string): Promise<GameRole[]> {
	const id = idOf(sourceId);
	if (!id) return Promise.resolve([]);
	const key = `game-roles|${sourceId}`;
	const kept = getOrderCache(key);
	if (kept && Array.isArray(kept.value) && Date.now() - kept.at < ((kept.value as unknown[]).length ? 30 : 7) * DAY) {
		return Promise.resolve(kept.value as GameRole[]);
	}
	const under = asking.get(key);
	if (under) return under;
	const work = lookUp(id.property, id.value)
		.then((games) => {
			if (games) saveOrderCache(key, games, Date.now());
			return games ?? (Array.isArray(kept?.value) ? (kept.value as GameRole[]) : []);
		})
		.finally(() => asking.delete(key));
	asking.set(key, work);
	return work;
}

/** The games, newest first; null when Wikidata couldn't be asked (not kept, asked again next time). */
async function lookUp(property: string, value: string): Promise<GameRole[] | null> {
	const sparql = `
SELECT DISTINCT ?game ?gameLabel ?charLabel ?charName ?year ?article WHERE {
  ?person wdt:${property} "${value}" .
  { ?game p:P725 ?st . ?st ps:P725 ?person . OPTIONAL { ?st pq:P453 ?char } OPTIONAL { ?st pq:P4633 ?charName } }
  UNION
  { ?char wdt:P725 ?person ; wdt:P1441 ?game . }
  ?game wdt:P31/wdt:P279* wd:Q7889 .
  OPTIONAL { ?game wdt:P577 ?date . BIND(YEAR(?date) AS ?year) }
  OPTIONAL { ?article schema:about ?game ; schema:isPartOf <https://en.wikipedia.org/> . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,ja". }
} LIMIT 600`;
	try {
		const response = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`, {
			headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
			signal: AbortSignal.timeout(30_000)
		});
		if (!response.ok) return null;
		type Cell = { value: string } | undefined;
		const rows = ((await response.json())?.results?.bindings ?? []) as Record<string, Cell>[];
		const games = new Map<string, { title: string; year: number | null; roles: Set<string>; link: string | null }>();
		const unnamed = (text: string) => /^Q\d+$/.test(text);
		for (const row of rows) {
			const id = row.game?.value ?? '';
			const title = row.gameLabel?.value ?? '';
			// A game with no name in any language asked for is left out (it'd show as "Q125420041").
			if (!id || !title || unnamed(title)) continue;
			const game = games.get(id) ?? { title, year: null, roles: new Set<string>(), link: null };
			const year = Number(row.year?.value) || null;
			if (year && (!game.year || year < game.year)) game.year = year;
			const role = row.charName?.value || row.charLabel?.value || '';
			if (role && !unnamed(role)) game.roles.add(role);
			if (!game.link && row.article?.value?.startsWith('https://en.wikipedia.org/')) game.link = row.article.value;
			games.set(id, game);
		}
		return [...games.values()]
			.map((g) => ({ title: g.title, year: g.year, roles: [...g.roles].slice(0, 6), link: g.link }))
			.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title));
	} catch {
		return null;
	}
}
