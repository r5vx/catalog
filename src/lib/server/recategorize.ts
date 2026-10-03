import { db } from './db';
import { env } from '$env/dynamic/private';
import { readSettings } from './settings';

const tmdbKey = () => (readSettings().tmdbApiKey || env.TMDB_API_KEY || '').trim();

/**
 * TMDB anime that were added before the anime detection existed end up
 * in the TV Shows category. This walks those entries once on startup,
 * checks the TMDB API for original_language, and moves the Japanese
 * animated ones to Anime where they belong.
 */
export function recategorizeAnime(): void {
	const key = tmdbKey();
	if (!key) return;

	const tvCat = db.prepare("SELECT id FROM categories WHERE slug = 'tv'").get() as { id: number } | undefined;
	const animeCat = db.prepare("SELECT id FROM categories WHERE slug = 'anime'").get() as { id: number } | undefined;
	if (!tvCat || !animeCat) return;

	const candidates = db.prepare(`
		SELECT e.id, e.source_id
		FROM entries e
		JOIN entry_tags et ON et.entry_id = e.id
		JOIN tags t ON t.id = et.tag_id
		WHERE e.source = 'tmdb'
		  AND e.source_id LIKE 'tv:%'
		  AND e.category_id = ?
		  AND t.name = 'Animation'
		  AND t.kind = 'genre'
	`).all(tvCat.id) as { id: number; source_id: string }[];

	if (candidates.length === 0) return;

	const update = db.prepare('UPDATE entries SET category_id = ? WHERE id = ?');

	const doWork = async () => {
		for (const entry of candidates) {
			const tmdbId = entry.source_id.replace('tv:', '');
			try {
				const url = new URL(`https://api.themoviedb.org/3/tv/${tmdbId}`);
				const init = key.startsWith('eyJ')
					? { headers: { Authorization: `Bearer ${key}` } }
					: (url.searchParams.set('api_key', key), {});

				const resp = await fetch(url, init);
				if (!resp.ok) continue;

				const data = await resp.json();
				if (data.original_language === 'ja') {
					update.run(animeCat.id, entry.id);
				}
			} catch {}
			await new Promise(r => setTimeout(r, 150));
		}
	};

	setTimeout(() => doWork().catch(() => {}), 5000);
}
