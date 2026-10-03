import { json, type RequestEvent } from '@sveltejs/kit';
import { searchShowbox, bestMatch } from '$lib/server/showbox';
import { fetchAlternativeTitles } from '$lib/server/metadata/tmdb';
import { fetchRomajiTitle } from '$lib/server/metadata/anilist';

const cache = new Map<string, { available: boolean; time: number }>();
const TTL = 30 * 60 * 1000;

export async function GET({ url }: RequestEvent) {
	const title = url.searchParams.get('title')?.trim();
	const type = url.searchParams.get('type') ?? '';
	const year = url.searchParams.get('year') ?? '';

	if (!title) return json({ available: false });

	const key = `${title.toLowerCase()}:${type}:${year}`;
	const cached = cache.get(key);
	if (cached && Date.now() - cached.time < TTL) return json({ available: cached.available });

	const results = await searchShowbox(title);
	let match = results.length > 0 ? bestMatch(results, title, type, year) : null;

	if (!match) {
		const altTitles: string[] = [];
		const tmdbType = type === 'movie' ? 'movie' as const : 'tv' as const;
		const tmdbAlts = await fetchAlternativeTitles(title, tmdbType);
		altTitles.push(...tmdbAlts);
		if (type === 'tv' || !type) {
			const romaji = await fetchRomajiTitle(title);
			if (romaji && !altTitles.includes(romaji)) altTitles.push(romaji);
		}
		const origWords = new Set(title.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((w: string) => w.length > 1));
		for (const alt of altTitles) {
			const candidate = await searchShowbox(alt);
			const best = candidate.length > 0 ? bestMatch(candidate, alt, type, year) : null;
			if (!best) continue;
			const matchWords = best.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((w: string) => w.length > 1);
			const altWords = alt.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((w: string) => w.length > 1);
			const related = matchWords.some((w: string) => origWords.has(w)) || altWords.some((w: string) => origWords.has(w));
			if (related) { match = best; break; }
		}
	}

	const available = match !== null;
	cache.set(key, { available, time: Date.now() });
	return json({ available });
}
