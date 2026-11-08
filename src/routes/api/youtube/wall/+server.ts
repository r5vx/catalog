import { json } from '@sveltejs/kit';
import { searchYouTube } from '$lib/server/youtube';
import type { RequestHandler } from './$types';

/**
 * Thumbnails for the moving wall behind Catalog's YouTube page: a mix of what's on YouTube (a few
 * everyday searches, YouTube's own answers), kept 12 hours. Only the pictures (YouTube's 320×180
 * ones, light to load); empty when YouTube can't be reached (the page draws plain tiles then).
 */
const SEARCHES = ['official music video', 'movie trailer', 'nature 4k', 'highlights', 'cooking', 'travel'];
const KEEP = 12 * 60 * 60 * 1000;
let kept: { at: number; thumbs: string[] } | null = null;
let asking: Promise<string[]> | null = null;

async function gather(): Promise<string[]> {
	const answers = await Promise.all(SEARCHES.map((q) => searchYouTube(q).catch(() => [])));
	const seen = new Set<string>();
	const thumbs: string[] = [];
	// Taken a few from each search in turn, so the kinds mix.
	for (let i = 0; i < 12; i++) {
		for (const list of answers) {
			const id = list[i]?.id;
			if (!id || seen.has(id)) continue;
			seen.add(id);
			thumbs.push(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`);
		}
	}
	return thumbs;
}

export const GET: RequestHandler = async () => {
	if (kept && Date.now() - kept.at < KEEP && kept.thumbs.length) return json({ thumbs: kept.thumbs });
	asking ??= gather().finally(() => (asking = null));
	const thumbs = await asking;
	if (thumbs.length) kept = { at: Date.now(), thumbs };
	return json({ thumbs });
};
