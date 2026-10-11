import { titleSourceByName } from './db/queries';
import { tmdbShow } from './combinedEpisodes';
import { tmdbGet } from './metadata/tmdb';

/**
 * Which page a title opens on the TV (`/tv/title/<source>/<id>`), from its name: the library's
 * own entry if it has one, else TMDB's. Null when neither knows it (it then plays straight away).
 */
export async function tvTitleLink(title: string, type: string): Promise<{ source: string; id: string } | null> {
	const owned = titleSourceByName(title);
	if (owned) return { source: owned.source, id: owned.sourceId };
	try {
		if (type === 'tv') {
			const show = await tmdbShow(title, '');
			return show ? { source: 'tmdb', id: `tv:${show.id}` } : null;
		}
		type Found = { results: { id: number; title?: string }[] };
		const found = await tmdbGet<Found>('/search/movie', { query: title });
		const film = found?.results.find((r) => r.title?.toLowerCase() === title.toLowerCase()) ?? found?.results[0];
		return film ? { source: 'tmdb', id: `movie:${film.id}` } : null;
	} catch {
		return null;
	}
}
