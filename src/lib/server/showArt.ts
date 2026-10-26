/**
 * Pictures for the TV shows on Live TV's schedule (Jeopardy!, Family Feud, SNL…): the show's own
 * picture from TMDB, wide (its backdrop), the way the rest of Catalog shows titles. Without one,
 * the card shows the show's name instead of a sport's photo (GameArt.svelte).
 *
 * Looked up by name only when it's an exact match ("Countdown to Election Night" mustn't get some
 * other show's picture), kept a month per name (a miss for a day), a few at a time.
 */
import type { LiveGame } from '$lib/live';
import { tmdbGet } from './metadata/tmdb';
import { getOrderCache, saveOrderCache } from './db/queries';

const DAY = 24 * 60 * 60 * 1000;
const asking = new Map<string, Promise<string | null>>();

/** "Jeopardy! S43, E31" → "Jeopardy!"; "Murder University • New" → "Murder University". */
export function showName(title: string): string {
	return title
		.replace(/\s*[•·—-]\s*(live|new|postgame|pregame)\b.*$/i, '')
		.replace(/\s*\([^)]*\)\s*$/, '')
		.replace(/\s+S\d+(,?\s*E\d+)?\s*$/i, '')
		.trim();
}

const plain = (name: string) =>
	name
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/&/g, ' and ')
		.replace(/^the\s+/, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

async function pictureOf(name: string): Promise<string | null> {
	const key = `show-picture1:${plain(name)}`;
	const kept = getOrderCache(key);
	if (kept) {
		const url = (kept.value as { url: string | null }).url;
		if (Date.now() - kept.at < (url ? 30 * DAY : DAY)) return url;
	}
	type Found = { results?: { name?: string; original_name?: string; backdrop_path?: string | null; poster_path?: string | null }[] };
	const found = await tmdbGet<Found>('/search/tv', { query: name, include_adult: 'false' });
	if (!found) return (kept?.value as { url: string | null } | undefined)?.url ?? null;
	const wanted = plain(name);
	const show = found.results?.find((s) => [s.name, s.original_name].some((n) => n && plain(n) === wanted) && (s.backdrop_path || s.poster_path));
	const path = show?.backdrop_path ?? show?.poster_path ?? null;
	const url = path ? `https://image.tmdb.org/t/p/w780${path}` : null;
	saveOrderCache(key, { url }, Date.now());
	return url;
}

function lookUp(name: string): Promise<string | null> {
	let going = asking.get(name);
	if (!going) {
		going = pictureOf(name)
			.catch(() => null)
			.finally(() => asking.delete(name));
		asking.set(name, going);
	}
	return going;
}

/** The shows with their pictures added where found, waiting at most `waitMs` (the next ask has the rest). */
export async function withShowPictures(games: LiveGame[], waitMs = 4000): Promise<LiveGame[]> {
	const names = [...new Set(games.filter((g) => g.sport === 'tv').map((g) => showName(g.title)).filter(Boolean))];
	if (!names.length) return games;
	const pictures = new Map<string, string>();
	const all = (async () => {
		// Four at a time: a schedule has thirty or so shows a day.
		for (let i = 0; i < names.length; i += 4) {
			const batch = names.slice(i, i + 4);
			const urls = await Promise.all(batch.map(lookUp));
			batch.forEach((name, j) => urls[j] && pictures.set(name, urls[j]!));
		}
	})();
	await Promise.race([all, new Promise((r) => setTimeout(r, waitMs))]);
	return games.map((g) => {
		const poster = g.sport === 'tv' ? pictures.get(showName(g.title)) : undefined;
		return poster ? { ...g, poster } : g;
	});
}
