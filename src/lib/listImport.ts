/**
 * The parts of importing a list from another site (src/lib/server/listImport.ts) that the page
 * needs too: a line's shape, a season's number from its name, and bringing a show's seasons
 * together as one entry once every line is matched.
 */
import type { SearchResult } from '$lib/server/metadata/types';

export type ListSite = 'mal' | 'anilist' | 'kitsu' | 'letterboxd' | 'imdb';
export type ListStatus = 'watching' | 'completed' | 'paused' | 'dropped' | 'planned' | 'rewatching';

/** One line of someone's list on another site. */
export type ListItem = {
	title: string;
	/** Its other names, tried when the first finds nothing. */
	alt: string[];
	year: number | null;
	kind: 'anime' | 'movie' | 'tv' | '';
	status: ListStatus;
	/** Out of 10 (halves allowed), or null. */
	score: number | null;
	/** Episodes watched, for a show. */
	progress: number | null;
	imdbId?: string;
};

/** One title to add: what it matched on TMDB (the others to pick from), and what's carried over. */
export type ImportRow = {
	options: SearchResult[];
	/** Their names on the other site: one, or a show's seasons. */
	from: string[];
	status: ListStatus;
	rating: number | null;
	lastSeason: number | null;
	lastEpisode: number | null;
};

/** "Re:ZERO Season 2", "Re:Zero kara Hajimeru Isekai Seikatsu 2nd Season Part 2": the show's own name, and which season. */
export function seasonOf(title: string): { base: string; season: number | null } {
	const patterns: [RegExp, (m: RegExpMatchArray) => number][] = [
		[/[\s:,-]*\bseason\s*(\d+)\b.*$/i, (m) => Number(m[1])],
		[/[\s:,-]*\b(\d+)(?:st|nd|rd|th)\s+season\b.*$/i, (m) => Number(m[1])],
		[/[\s:,-]*\bs(\d{1,2})\b.*$/i, (m) => Number(m[1])],
		// Avatar: The Last Airbender's "Book 2: Earth".
		[/[\s:,-]*\bbook\s*(\d+)\b.*$/i, (m) => Number(m[1])],
		[/\s+(II|III|IV|V)$/, (m) => ({ II: 2, III: 3, IV: 4, V: 5 })[m[1] as 'II'] ?? 2],
		[/[\s:,-]*\bpart\s*\d+\b.*$/i, () => 0],
		[/[\s:,-]*\b(final season|the final)\b.*$/i, () => 0]
	];
	for (const [pattern, number] of patterns) {
		const m = title.match(pattern);
		if (m) {
			const n = number(m);
			return { base: title.slice(0, m.index).replace(/[\s:,-]+$/, '').trim(), season: n || null };
		}
	}
	return { base: title.trim(), season: null };
}

/** A film on TMDB (not a show), whatever its card says (an anime film's says Anime). */
export const isFilm = (r: SearchResult) => r.sourceId.startsWith('movie:') || r.key.includes(':movie:');

/** The status that says the most about a show from its seasons' statuses. */
function together(statuses: ListStatus[]): ListStatus {
	for (const s of ['watching', 'rewatching', 'paused'] as const) if (statuses.includes(s)) return s;
	if (statuses.includes('completed')) return statuses.includes('planned') ? 'paused' : 'completed';
	if (statuses.includes('dropped')) return 'dropped';
	return 'planned';
}

/** Matched lines as titles to add: a show's seasons (the same best match) together. */
export function groupMatches(matched: { item: ListItem; options: SearchResult[] }[]): ImportRow[] {
	const groups = new Map<string, { item: ListItem; options: SearchResult[] }[]>();
	for (const m of matched) if (m.options.length) groups.set(m.options[0].key, [...(groups.get(m.options[0].key) ?? []), m]);
	const rows: ImportRow[] = [];
	for (const group of groups.values()) {
		const ordered = [...group].sort((a, b) => (seasonOf(a.item.title).season ?? 1) - (seasonOf(b.item.title).season ?? 1) || (a.item.year ?? 0) - (b.item.year ?? 0));
		const scores = ordered.map((m) => m.item.score).filter((s): s is number => s !== null);
		const show = !isFilm(ordered[0].options[0]);
		// Where you got to: the last season started, and its episode.
		const reached = [...ordered].reverse().find((m) => m.item.status !== 'planned' && (m.item.progress ?? 0) > 0);
		const seasonNumber = reached ? (seasonOf(reached.item.title).season ?? ordered.indexOf(reached) + 1) : null;
		rows.push({
			options: ordered[0].options,
			from: ordered.map((m) => m.item.title),
			status: together(ordered.map((m) => m.item.status)),
			rating: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 2) / 2 : null,
			lastSeason: show && reached ? seasonNumber : null,
			lastEpisode: show && reached ? reached.item.progress : null
		});
	}
	return rows;
}
