/**
 * Notes lists are messy. A line might be any of these:
 *
 *   - Fantastic Four (2005)
 *   2. Iron Man [2008]
 *   • Arrival (rewatched)
 *
 * The databases can't match a title with "(2005)" stuck on the end, so we pull
 * that off — and when it IS a year, we keep it, because knowing the year is the
 * difference between finding the right Fantastic Four and the wrong one.
 */
export type ParsedTitle = {
	/** The line as you wrote it, shown back to you in the review list. */
	raw: string;
	/** What we actually search for. */
	title: string;
	/** A year found on the line, used to prefer the matching release. */
	year: number | null;
	/** How far you got, from a marker like "(S1E23)". Null when not written. */
	season: number | null;
	episode: number | null;
};

/**
 * Where you left off in a series. Accepts the ways people actually write it:
 *
 *   (S1E23)   S01E23   s1 e23   1x23   S2   Season 2 Episode 5
 */
const PROGRESS_PATTERNS = [
	/^s(?:eason)?\s*(\d{1,3})\s*[\s.x_-]*e(?:p(?:isode)?)?\s*(\d{1,4})$/i,
	/^(\d{1,3})\s*x\s*(\d{1,4})$/i,
	/^s(?:eason)?\s*(\d{1,3})$/i,
	/^e(?:p(?:isode)?)?\s*(\d{1,4})$/i
];

function readProgress(text: string): { season: number | null; episode: number | null } | null {
	// People star their own entries — "(S2E7*)" still means season 2, episode 7.
	const cleaned = text.replace(/[*]/g, '').trim();

	for (const [index, pattern] of PROGRESS_PATTERNS.entries()) {
		const match = cleaned.match(pattern);
		if (!match) continue;

		// The last two patterns carry only one number each.
		if (index === 2) return { season: Number(match[1]), episode: null };
		if (index === 3) return { season: null, episode: Number(match[1]) };

		return { season: Number(match[1]), episode: Number(match[2]) };
	}

	return null;
}

const LEADING_BULLET = /^\s*[-*•●▪·]+\s*/;
/** Asterisks are markers people add to their own lists, never part of a title. */
const STRAY_ASTERISKS = /(^[\s*]+)|([\s*]+$)/g;
const LEADING_NUMBER = /^\s*\d+[.)]\s*/;
const TRAILING_BRACKET = /\s*[([]([^)\]]*)[)\]]\s*$/;
const YEAR_ONLY = /^(?:19|20)\d{2}$/;

/** Pull one list line apart into a searchable title and, if present, a year. */
export function parseTitle(line: string): ParsedTitle {
	const raw = line.trim();

	let title = raw
		.replace(LEADING_BULLET, '')
		.replace(LEADING_NUMBER, '')
		.replace(STRAY_ASTERISKS, '')
		.trim();
	let year: number | null = null;
	let season: number | null = null;
	let episode: number | null = null;

	// Peel trailing bracketed notes off the end, newest first, because a line can
	// carry more than one: "Breaking Bad (2008) (S5E14)".
	for (let pass = 0; pass < 3; pass++) {
		const bracketed = title.match(TRAILING_BRACKET);
		if (!bracketed) break;

		const inside = bracketed[1].replace(/[*]/g, '').trim();
		const progress = readProgress(inside);

		if (YEAR_ONLY.test(inside)) year = Number(inside);
		else if (progress) {
			season ??= progress.season;
			episode ??= progress.episode;
		}

		const withoutBrackets = title.replace(TRAILING_BRACKET, '').trim();
		// Don't strip it away to nothing — "(500) Days of Summer" style lines.
		if (withoutBrackets.length < 2) break;
		title = withoutBrackets;
	}

	// Also handles the bare form, with no brackets: "Breaking Bad S5E14"
	const bare = title.match(/\s+(s(?:eason)?\s*\d{1,3}(?:\s*[\s.x_-]*e(?:p(?:isode)?)?\s*\d{1,4})?|\d{1,3}x\d{1,4})$/i);
	if (bare && season === null && episode === null) {
		const progress = readProgress(bare[1]);
		if (progress) {
			season = progress.season;
			episode = progress.episode;
			title = title.slice(0, bare.index).trim();
		}
	}

	const cleaned = title
		.replace(STRAY_ASTERISKS, '')
		.replace(/\s*[:：]\s*$/, '')
		.trim();

	return { raw, title: cleaned, year, season, episode };
}

/** Split a pasted block into lines, cleaning and de-duplicating as we go. */
export function parseList(text: string): ParsedTitle[] {
	const seen = new Set<string>();

	return text
		.split(/\r?\n/)
		.map(parseTitle)
		.filter((item) => {
			if (item.title.length < 2) return false;

			const key = `${item.title.toLowerCase()}|${item.year ?? ''}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
}
