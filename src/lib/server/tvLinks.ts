import { releaseParts, filmHit } from '../release';
import { titleSourceByName } from './db/queries';
import { tmdbShow } from './combinedEpisodes';
import { tmdbGet } from './metadata/tmdb';

/**
 * Which page a title opens on the TV (`/tv/title/<source>/<id>`), from its name: the library's
 * own entry if it has one, else TMDB's. Null when neither knows it (it then plays straight away).
 */
export async function tvTitleLink(title: string, type: string): Promise<{ source: string; id: string } | null> {
	const parts = releaseParts(title);
	const owned = !parts.year && titleSourceByName(title);
	if (owned && (owned.source !== 'tmdb' || owned.sourceId.startsWith(type + ':'))) return { source: owned.source, id: owned.sourceId };
	try {
		if (type === 'tv') {
			const show = await tmdbShow(parts.title, parts.year);
			return show ? { source: 'tmdb', id: `tv:${show.id}` } : null;
		}
		type Found = { results: { id: number; title?: string; release_date?: string }[] };
		const found = await tmdbGet<Found>('/search/movie', { query: parts.title, ...(parts.year ? {year: parts.year} : {}) });
		const film = filmHit(found?.results ?? [], parts.title, parts.year);
		return film ? { source: 'tmdb', id: `movie:${film.id}` } : null;
	} catch {
		return null;
	}
}
