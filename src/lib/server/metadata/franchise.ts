/**
 * One show, not one card per season.
 *
 * AniList gives every season its own entry ("Re:ZERO", "Re:ZERO Season 2", an OVA…) and links
 * them as prequel and sequel. Showbox, and anyone watching, treats them as one show. This walks
 * those links back to the first season — the "root" — and groups everything that is clearly a
 * season of it.
 *
 * "Clearly" matters: Naruto Shippuden is Naruto's sequel on AniList but a separate show
 * everywhere else, so a sequel only joins the group when its name is the root's name plus a
 * season-like ending (Season 2, Part 2, II, …Arc), or when TMDB says so. Films, OVAs and specials
 * are never seasons; they only serve as links in the chain between seasons.
 *
 * On a search or browse card, though, an OVA or special folds into the show it belongs to (it
 * plays from the show's Specials season); films keep their own cards. That's only for cards:
 * library entries for OVAs stay as they are.
 *
 * TMDB is what Showbox goes by, and it files some sequels with other names as seasons:
 * "JoJo's Bizarre Adventure: Stardust Crusaders" is JoJo's season 2 there. So a sequel whose
 * name starts with the show's name also joins when TMDB has a season of that show airing at the
 * time it started. Naruto Shippuden starts with "Naruto", but no Naruto season covers 2007, so
 * it stays separate, as it is on Showbox.
 */
import { normalizeTitle, withoutQualifier, type SearchResult } from './types';
import { toResult } from './anilist';
import { animeNodes as nodes, anilistResting, anilistSaidWait, type AnimeNode as Node } from './anilistNodes';
import { savedAnimeRoots, saveAnimeRoots } from '../db/queries';
import { tmdbGet } from './tmdb';

const ENDPOINT = 'https://graphql.anilist.co';

const NODE_QUERY = `
query ($ids: [Int], $page: Int) {
  Page(perPage: 50, page: $page) {
    media(id_in: $ids, type: ANIME) {
      id
      title { romaji english }
      startDate { year month day }
      episodes
      duration
      format
      popularity
      averageScore
      coverImage { large }
      description(asHtml: false)
      relations { edges { relationType node { id format } } }
    }
  }
}`;

const roots = new Map<number, number>();

/** What may follow the first season's name for it to still be the same show. */
const SEASON_SUFFIX =
	/^(?:|\d+|(?:ii|iii|iv|v|vi|vii)\b.*|.*\b(?:season|part|cour|\d+(?:st|nd|rd|th)|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|final|arc|hen|ovas?|oads?|ona|specials?|recap|picture drama|extras?)\b.*)$/;

function titlesOf(node: Node): string[] {
	return [node.title.english, node.title.romaji]
		.filter((t): t is string => Boolean(t))
		.map((t) => normalizeTitle(withoutQualifier(t)));
}

/** Its name is the show's name with more after it ("JoJo's Bizarre Adventure: Stardust Crusaders"). */
function startsWithName(node: Node, root: Node): boolean {
	return titlesOf(node).some((t) => titlesOf(root).some((r) => t.startsWith(`${r} `)));
}

/* ------------------------------------------------ asking TMDB */

const SHOW_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA']);
const DAY = 24 * 60 * 60 * 1000;

/** Each TMDB season of the show an AniList entry is: when it started and roughly when it ended. */
type SeasonSpan = { from: number; to: number };
const tmdbSeasons = new Map<number, SeasonSpan[]>();

function startOf(node: Node): number | null {
	const { year, month, day } = node.startDate ?? {};
	return year && month ? Date.UTC(year, month - 1, day ?? 1) : null;
}

async function lookUpTmdbSeasons(root: Node): Promise<SeasonSpan[] | null> {
	const name = withoutQualifier(root.title.english ?? root.title.romaji ?? '');
	if (!name || !root.startDate?.year) return [];
	const found = await tmdbGet<{ results: { id: number }[] }>('/search/tv', {
		query: name,
		first_air_date_year: String(root.startDate.year)
	});
	if (!found) return null; // couldn't ask
	const id = found.results[0]?.id;
	if (!id) return [];
	const show = await tmdbGet<{ seasons?: { season_number: number; air_date: string | null; episode_count: number }[] }>(`/tv/${id}`);
	if (!show) return null;
	return (show.seasons ?? [])
		.filter((season) => season.season_number > 0 && season.air_date)
		.map((season) => {
			const from = Date.parse(season.air_date!);
			// Weekly episodes; breaks only make a real season run longer than this, never shorter.
			return { from, to: from + Math.max(1, season.episode_count) * 7 * DAY };
		});
}

/** TMDB has a season of the root's show that began, or was running, when this started. */
function tmdbSaysSeason(node: Node, root: Node): boolean {
	const spans = tmdbSeasons.get(root.id);
	const start = startOf(node);
	if (!spans || start === null) return false;
	return spans.some((span) => Math.abs(start - span.from) <= 45 * DAY || (start >= span.from && start <= span.to));
}

/** Asks TMDB about every earlier show whose name a sequel here starts with. */
async function askTmdbAbout(ids: number[]): Promise<void> {
	const wanted = new Set<number>();
	for (const id of ids) {
		const node = nodes.get(id);
		if (!node || !SHOW_FORMATS.has(node.format ?? '')) continue;
		for (const ancestor of ancestorsOf(node)) {
			const before = nodes.get(ancestor);
			if (before && !tmdbSeasons.has(ancestor) && startsWithName(node, before)) wanted.add(ancestor);
		}
	}
	await Promise.all(
		[...wanted].map(async (id) => {
			const spans = await lookUpTmdbSeasons(nodes.get(id)!);
			if (spans) tmdbSeasons.set(id, spans);
		})
	);
}

function isSeasonOf(node: Node, root: Node): boolean {
	for (const t of titlesOf(node)) {
		for (const r of titlesOf(root)) {
			if (t === r) return true;
			if (t.startsWith(`${r} `) && SEASON_SUFFIX.test(t.slice(r.length + 1))) return true;
		}
	}
	return false;
}

/** The entry this one continues from: its prequel, or for an OVA/special, the show it belongs to. */
function parentOf(node: Node): number | null {
	const edges = node.relations?.edges ?? [];
	const prequels = edges.filter((e) => e.relationType === 'PREQUEL');
	const prequel = prequels.find((e) => e.node.format !== 'MOVIE') ?? prequels[0];
	if (prequel) return prequel.node.id;
	if (node.format === 'OVA' || node.format === 'SPECIAL') {
		return edges.find((e) => e.relationType === 'PARENT')?.node.id ?? null;
	}
	return null;
}

async function fetchNodes(ids: number[]): Promise<boolean> {
	const missing = [...new Set(ids)].filter((id) => !nodes.has(id));
	if (missing.length && anilistResting()) return false;
	for (let i = 0; i < missing.length; i += 50) {
		const batch = missing.slice(i, i + 50);
		try {
			const resp = await fetch(ENDPOINT, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify({ query: NODE_QUERY, variables: { ids: batch, page: 1 } }),
				signal: AbortSignal.timeout(10000)
			});
			if (resp.status === 429) {
				anilistSaidWait(resp);
				return false;
			}
			if (!resp.ok) return false;
			const media = ((await resp.json())?.data?.Page?.media ?? []) as Node[];
			for (const m of media) nodes.set(m.id, m);
		} catch {
			return false;
		}
	}
	return true;
}

/** Everything this entry continues from, nearest first, skipping films. Stops where nothing is known. */
function ancestorsOf(node: Node): number[] {
	const out: number[] = [];
	const seen = new Set([node.id]);
	let parentId = parentOf(node);
	while (parentId !== null && !seen.has(parentId) && out.length < 20) {
		seen.add(parentId);
		const parent = nodes.get(parentId);
		if (!parent) break;
		if (parent.format !== 'MOVIE') out.push(parentId);
		parentId = parentOf(parent);
	}
	return out;
}

function computeRoot(id: number, depth = 0): number {
	const known = roots.get(id);
	if (known !== undefined) return known;
	const node = nodes.get(id);
	// Films, OVAs and specials keep their own cards — Showbox doesn't reliably file OVAs with the show.
	if (!node || depth > 20 || node.format === 'MOVIE' || node.format === 'OVA' || node.format === 'SPECIAL') return id;

	// The nearest earlier entry whose show this is a season of. Checking further back too means
	// an oddly named OVA in the middle (Slime's "Visions of Coleus") doesn't cut a show in two.
	for (const ancestor of ancestorsOf(node)) {
		const root = computeRoot(ancestor, depth + 1);
		const rootNode = nodes.get(root);
		if (rootNode && (isSeasonOf(node, rootNode) || (startsWithName(node, rootNode) && tmdbSaysSeason(node, rootNode)))) {
			return root;
		}
	}
	return id;
}

/**
 * The first season of the show each AniList id belongs to (itself when it stands alone).
 * Ids AniList couldn't be asked about map to themselves and aren't remembered.
 */
export async function showRoots(ids: number[]): Promise<Map<number, number>> {
	const unique = [...new Set(ids)];
	const result = savedAnimeRoots(unique);
	const todo = unique.filter((id) => !result.has(id) && !roots.has(id));
	for (const id of unique) if (roots.has(id)) result.set(id, roots.get(id)!);
	if (todo.length === 0) return result;

	let complete = await fetchNodes(todo);
	for (let round = 0; round < 10 && complete; round++) {
		// Climb through what's already known to the first link that isn't, from every entry.
		const unknown = new Set<number>();
		for (const id of todo) {
			const seen = new Set<number>();
			let parentId = nodes.has(id) ? parentOf(nodes.get(id)!) : null;
			while (parentId !== null && !seen.has(parentId)) {
				seen.add(parentId);
				const parent = nodes.get(parentId);
				if (!parent) { unknown.add(parentId); break; }
				parentId = parentOf(parent);
			}
		}
		if (unknown.size === 0) break;
		complete = await fetchNodes([...unknown]);
	}

	if (complete) await askTmdbAbout(todo);

	const fresh = new Map<number, number>();
	for (const id of todo) {
		const root = computeRoot(id);
		result.set(id, root);
		if (complete && nodes.has(id)) {
			roots.set(id, root);
			fresh.set(id, root);
		}
	}
	if (fresh.size) saveAnimeRoots(fresh);
	return result;
}

/** The series an OVA or special belongs to: its parent, a side story's series, or the one it follows. */
function showParentOf(node: Node): number | null {
	const edges = node.relations?.edges ?? [];
	const isShow = (format: string | null) => SHOW_FORMATS.has(format ?? '');
	for (const relation of ['PARENT', 'SIDE_STORY', 'PREQUEL']) {
		const edge = edges.find((e) => e.relationType === relation && isShow(e.node.format));
		if (edge) return edge.node.id;
	}
	return null;
}

/** The first season as a card, for when only a later season turned up in the results. */
async function rootCard(rootId: number): Promise<SearchResult | null> {
	if (!nodes.has(rootId)) await fetchNodes([rootId]);
	const node = nodes.get(rootId);
	return node ? toResult(node) : null;
}

/**
 * One card per show: later seasons and OVAs fold into the first season's card.
 * `keepOrder` keeps whichever member came first (and its place) — for lists sorted by date,
 * where swapping in a years-old first season would break the order.
 */
export async function groupByShow(results: SearchResult[], keepOrder = false): Promise<SearchResult[]> {
	const anime = results.filter((r) => r.source === 'anilist');
	if (anime.length === 0) return results;

	const rootOf = await showRoots(anime.map((r) => Number(r.sourceId)));

	// OVAs and specials: the show they hang off, then that show's first season.
	const extraParent = new Map<number, number>();
	for (const r of anime) {
		const id = Number(r.sourceId);
		const node = nodes.get(id);
		if (!node || (node.format !== 'OVA' && node.format !== 'SPECIAL')) continue;
		const parent = showParentOf(node);
		if (parent) extraParent.set(id, parent);
	}
	if (extraParent.size) {
		const parentRoots = await showRoots([...extraParent.values()]);
		for (const [id, parent] of extraParent) rootOf.set(id, parentRoots.get(parent) ?? parent);
	}

	const out: SearchResult[] = [];
	const placed = new Map<number, number>();

	for (const result of results) {
		if (result.source !== 'anilist') {
			out.push(result);
			continue;
		}
		const root = rootOf.get(Number(result.sourceId)) ?? Number(result.sourceId);
		if (placed.has(root)) {
			// A later member of a show already shown: take over the spot if it's the first season.
			const at = placed.get(root)!;
			if (!keepOrder && String(root) === result.sourceId) out[at] = result;
			continue;
		}
		let card = result;
		if (!keepOrder && String(root) !== result.sourceId) card = (await rootCard(root)) ?? result;
		placed.set(root, out.length);
		out.push(card);
	}
	return out;
}
